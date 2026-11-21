#!/bin/sh
# ==============================================================================
# CF-Server-Monitor 安装/卸载脚本 (OpenWrt 安全加固版)
# 支持: OpenWrt / LEDE / ImmortalWrt (procd + opkg/apk)
# 纯 POSIX sh 实现，无 bash 依赖，64 位 awk 浮点防 32 位 ash 整数溢出
# ==============================================================================

set -eu
export LC_ALL=C LANG=C

AGENT_VERSION="1.3.8"

CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
OLD_TRAFFIC_DATA_FILE="/var/lib/cf-probe/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000
AUTO_UPDATE_DELAY_SECONDS=60

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SERVICE_NAME="cf-probe"
PROCD_FILE="/etc/init.d/${SERVICE_NAME}"
SCRIPT_FILE="/usr/local/bin/${SERVICE_NAME}.sh"
PID_FILE="/var/run/${SERVICE_NAME}.pid"
LOG_FILE="/var/log/${SERVICE_NAME}.log"

mkdir -p /usr/local/bin /var/run /var/log 2>/dev/null || true

print_banner() {
    printf '%b╔═════════════════════════════════════╗%b\n' "${CYAN}" "${NC}"
    printf '%b║     CF-Server-Monitor (OpenWrt)     ║%b\n' "${CYAN}" "${NC}"
    printf '%b╚═════════════════════════════════════╝%b\n' "${CYAN}" "${NC}"
}

info()  { printf '%b[✓]%b %s\n' "${GREEN}" "${NC}" "$1"; }
warn()  { printf '%b[!]%b %s\n' "${YELLOW}" "${NC}" "$1"; }
error() { printf '%b[✗]%b %s\n' "${RED}"   "${NC}" "$1"; exit 1; }
step()  { printf '%b[→]%b %s\n' "${BLUE}"  "${NC}" "$1"; }

print_usage() {
    printf '%b错误: 运行所需的入参不完整。%b\n\n' "${RED}" "${NC}"
    echo "用法:"
    echo "  CF_PROBE_SECRET=xxx sh $0 install -id=SERVER_ID -url=WORKER_URL [选项]"
    echo "  sh $0 install -id=SERVER_ID -secret=SECRET -url=WORKER_URL [选项]"
    echo ""
    echo "必需参数:"
    echo "  -id=xxx        服务器ID"
    echo "  -secret=xxx    密钥（推荐通过环境变量 CF_PROBE_SECRET 传入以避免出现在进程列表中）"
    echo "  -url=xxx       上报地址（必须以 https:// 或 http:// 开头）"
    echo ""
    echo "可选参数:"
    echo "  -interval=N    上报间隔(秒)，默认60"
    echo "  -collect_interval=N    采样间隔(秒)，默认0"
    echo "  -ct=HOST       自定义CT测试节点"
    echo "  -cu=HOST       自定义CU测试节点"
    echo "  -cm=HOST       自定义CM测试节点"
    echo "  -bd=HOST       自定义BD测试节点"
    echo "  -interface=IFACES 指定网卡统计，多个用英文逗号分隔，默认自动汇总"
    echo "  -reset_day=N   流量重置日(1-31, 0=不重置)，默认1"
    echo "  -auto_update=0|1 自动更新探针，默认0"
    echo "  -rx_correction=N  下行流量校正(GB)，覆盖当月下行数据"
    echo "  -tx_correction=N  上行流量校正(GB)，覆盖当月上行数据"
    exit 1
}

validate_worker_url() {
    _v_url="${1:-}"
    [ "${#_v_url}" -ge 8 ] || return 1
    case "$_v_url" in
        https://?*|http://?*) ;;
        *) return 1 ;;
    esac
    case "$_v_url" in
        *[[:space:][:cntrl:]\"\'\\\`]*) return 1 ;;
    esac
    return 0
}

ensure_secure_config_dir() {
    (umask 077; mkdir -p "${CONFIG_DIR}")
    if [ ! -d "${CONFIG_DIR}" ] || [ -L "${CONFIG_DIR}" ]; then
        error "配置目录异常（非目录或存在符号链接）: ${CONFIG_DIR}"
    fi
    chmod 700 "${CONFIG_DIR}"
}

atomic_write_file() {
    _target="$1"
    _dir=$(dirname "$_target")
    (umask 077; mkdir -p "$_dir")
    _tmp=$(umask 077; mktemp "${_target}.tmp.XXXXXX") || error "无法创建临时文件: ${_target}"
    if (umask 077; cat > "$_tmp"); then
        chmod 600 "$_tmp" 2>/dev/null || true
        mv -f "$_tmp" "$_target"
    else
        rm -f "$_tmp"
        error "写入文件失败: ${_target}"
    fi
}

normalize_binary_value() {
    _cf_binary_value="${1-}"
    _cf_binary_default="${2-}"
    [ -z "$_cf_binary_value" ] && _cf_binary_value="$_cf_binary_default"
    case "$_cf_binary_value" in
        0|1) printf '%s' "$_cf_binary_value" ;;
        *) return 1 ;;
    esac
}

is_valid_correction_value() {
    _corr_val="${1:-}"
    case "$_corr_val" in
        ''|*[!0-9.]*|.*|*.) return 1 ;;
        *.*.*) return 1 ;;
    esac
    awk -v v="$_corr_val" -v max="${MAX_TRAFFIC_CORRECTION_GB:-1000000}" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v + 0 >= 0 && v + 0 <= max) }'
}

normalize_interface_list() {
    printf '%s' "${1:-}" | awk -F',' '
        BEGIN { out=""; bad=0; total=0 }
        {
            for (i=1; i<=NF; i++) {
                name=$i
                gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", name)
                if (name == "") continue
                if (length(name) > 64 || name !~ /^[A-Za-z0-9_.:-]+$/) { bad=1; next }
                if (!seen[name]++) {
                    out = (out == "" ? name : out "," name)
                    total += length(name)
                }
            }
        }
        END {
            if (bad || length(out) > 255 || total > 255) exit 1
            printf "%s", out
        }'
}

get_configured_net_bytes() {
    interfaces=$(normalize_interface_list "${1:-}") || interfaces=""
    awk -v interfaces="$interfaces" '
        BEGIN {
            split(interfaces, parts, ",")
            for (i in parts) if (parts[i] != "") wanted[parts[i]] = 1
        }
        NR > 2 {
            iface=$1
            sub(/:$/, "", iface)
            if (interfaces != "") {
                if (wanted[iface]) { rx += $2; tx += $10 }
            } else if ($1 ~ /^(eth|en|wl)[a-z0-9]*:/) {
                rx += $2; tx += $10
            }
        }
        END { printf "%.0f %.0f\n", rx+0, tx+0 }
    ' /proc/net/dev 2>/dev/null || echo "0 0"
}

to_uint() {
    _cf_num=$(printf '%s' "${1:-0}" | sed 's/^0*//')
    case "${_cf_num}" in
        ''|*[!0-9]*) echo 0 ;;
        ?|??|???|????|?????|??????|???????|????????|?????????) echo "${_cf_num}" ;;
        *) echo 0 ;;
    esac
}

normalize_reset_day() {
    _cf_day=$(printf '%s' "${1:-1}" | sed 's/^0*//')
    case "${_cf_day}" in
        '') echo 0 ;;
        *[!0-9]*) echo 1 ;;
        0|[1-9]|1[0-9]|2[0-9]|30|31) echo "${_cf_day}" ;;
        *) echo 1 ;;
    esac
}

normalize_probe_config() {
    COLLECT_INTERVAL=$(to_uint "${COLLECT_INTERVAL:-0}")
    REPORT_INTERVAL=$(to_uint "${REPORT_INTERVAL:-60}")
    [ "${REPORT_INTERVAL}" -lt 1 ] && REPORT_INTERVAL=60
    if [ "${COLLECT_INTERVAL}" -gt 0 ] && [ "${REPORT_INTERVAL}" -lt "${COLLECT_INTERVAL}" ]; then
        REPORT_INTERVAL="${COLLECT_INTERVAL}"
    fi
    RESET_DAY=$(normalize_reset_day "${RESET_DAY:-1}")
}

check_root() {
    if [ "$(id -u)" != "0" ]; then
        error "请使用 root 权限运行此脚本: sudo sh $0"
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        OS_ID=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'" || true)
    elif [ -f /etc/openwrt_release ]; then
        OS_ID="openwrt"
    else
        OS_ID=$(uname -s | tr '[:upper:]' '[:lower:]')
    fi
    OS_ID=${OS_ID:-"unknown"}

    case "$OS_ID" in
        immortalwrt|openwrt|lede)
            if command -v apk >/dev/null 2>&1; then
                PKG_MGR="apk"
            elif command -v opkg >/dev/null 2>&1; then
                PKG_MGR="opkg"
            else
                error "未找到可用的包管理器 (apk/opkg)，当前系统: $OS_ID"
            fi
            ;;
        *)
            warn "检测到非 OpenWrt 系统: $OS_ID，仍将尝试使用 opkg"
            PKG_MGR="opkg"
            ;;
    esac

    if command -v procd >/dev/null 2>&1 || [ -f /sbin/procd ]; then
        INIT_SYSTEM="procd"
    elif command -v rc-service >/dev/null 2>&1 && [ -d /etc/runlevels ]; then
        INIT_SYSTEM="openrc"
    elif [ -d /run/systemd/system ]; then
        INIT_SYSTEM="systemd"
    else
        INIT_SYSTEM="manual"
    fi
}

install_deps() {
    step "检查系统依赖组件..."

    case "$PKG_MGR" in
        apk)
            required_pkgs="curl coreutils procps-ng ip-full"
            optional_ping_pkg="iputils"
            if ! command -v apk >/dev/null 2>&1; then
                error "未找到 apk 包管理器。"
            fi
            step "刷新 APK 索引并安装基础依赖..."
            apk update --quiet >/dev/null 2>&1 || true
            # shellcheck disable=SC2086
            apk add --no-cache --quiet $required_pkgs >/dev/null 2>&1 || \
                apk add --no-cache $required_pkgs || \
                warn "部分依赖安装失败，请手动执行: apk add $required_pkgs"
            apk add --no-cache --quiet $optional_ping_pkg >/dev/null 2>&1 || true
            ;;
        opkg)
            required_pkgs="curl coreutils procps-ng ip-full"
            optional_ping_pkg="iputils-ping"
            if ! command -v opkg >/dev/null 2>&1; then
                error "未找到 opkg 包管理器，当前系统不是 OpenWrt 系列。"
            fi
            step "更新 OPKG 索引并安装基础依赖..."
            opkg update >/dev/null 2>&1 || true
            # shellcheck disable=SC2086
            opkg install $required_pkgs >/dev/null 2>&1 || \
                opkg install --force-overwrite $required_pkgs >/dev/null 2>&1 || \
                warn "部分依赖安装失败，请手动执行: opkg install $required_pkgs"
            opkg install $optional_ping_pkg >/dev/null 2>&1 || true
            ;;
        *)
            error "未知的包管理器: ${PKG_MGR}"
            ;;
    esac

    for cmd in curl awk grep sed; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            warn "缺少依赖: ${cmd}，某些功能可能不可用。"
        fi
    done

    if ! command -v ping >/dev/null 2>&1; then
        warn "未找到 ping，丢包率监控将上报为空；可手动安装 iputils-ping 或系统自带 ping 包"
    fi

    info "基础依赖组件检查通过"
    case "$INIT_SYSTEM" in
        procd)   info "检测到 procd，将注册为 OpenWrt 系统服务。" ;;
        openrc)  info "检测到 OpenRC，将注册为系统服务。" ;;
        systemd) warn "检测到 systemd — 建议使用 install.sh。" ;;
        manual)  warn "未检测到 init 系统，将采用后台进程方式运行。" ;;
    esac
}

kill_matching_processes() {
    _pat="$1"
    _self="$$"
    _ppid="${PPID:-0}"
    (ps -ww 2>/dev/null || ps -eo pid=,args= 2>/dev/null || ps 2>/dev/null) | PAT="$_pat" awk -v sp="$_self" -v pp="$_ppid" '
        $1 ~ /^[0-9]+$/ && $1 != sp && $1 != pp && index($0, ENVIRON["PAT"]) > 0 { print $1 }
    ' | while IFS= read -r _pid; do
        [ -n "$_pid" ] && kill -9 "$_pid" 2>/dev/null || true
    done
}

stop_old_service() {
    step "清理可能存在的旧服务进程..."

    if [ "$INIT_SYSTEM" = "procd" ] && [ -f "$PROCD_FILE" ]; then
        "$PROCD_FILE" stop >/dev/null 2>&1 || true
        "$PROCD_FILE" disable >/dev/null 2>&1 || true
        rm -f "$PROCD_FILE"
    elif [ "$INIT_SYSTEM" = "openrc" ] && [ -f "$PROCD_FILE" ]; then
        rc-service "$SERVICE_NAME" stop >/dev/null 2>&1 || true
        rc-update del "$SERVICE_NAME" default >/dev/null 2>&1 || true
        rm -f "$PROCD_FILE"
    fi

    if [ -f "$PID_FILE" ]; then
        old_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
        case "$old_pid" in
            ''|*[!0-9]*) ;;
            *)
                if kill -0 "$old_pid" >/dev/null 2>&1; then
                    kill -TERM "$old_pid" >/dev/null 2>&1 || true
                    sleep 1
                    kill -9 "$old_pid" >/dev/null 2>&1 || true
                fi
                ;;
        esac
        rm -f "$PID_FILE"
    fi

    kill_matching_processes "${SCRIPT_FILE}"
}

create_script() {
    step "注入工业级监控采集探针..."
    mkdir -p /usr/local/bin 2>/dev/null || true

    _script_tmp=$(umask 077; mktemp "${SCRIPT_FILE}.tmp.XXXXXX")
    cat << 'PROBE_EOF' | sed "s|__AGENT_VERSION__|${AGENT_VERSION}|g" > "${_script_tmp}"
#!/bin/sh
set +eu
export LC_ALL=C LANG=C

AGENT_VERSION="__AGENT_VERSION__"
PID_FILE="/var/run/cf-probe.pid"
echo $$ > "$PID_FILE"

CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000
AUTO_UPDATE_DELAY_SECONDS=60

verify_secure_dir() {
    _v_dir="$1"
    (umask 077; mkdir -p "$_v_dir" 2>/dev/null) || return 1
    [ -d "$_v_dir" ] && [ ! -L "$_v_dir" ] || return 1
    _cur_uid=$(id -u)
    _owner_uid=$(stat -c '%u' "$_v_dir" 2>/dev/null || true)
    case "$_owner_uid" in
        ''|*[!0-9]*) _owner_uid="" ;;
    esac
    if [ -z "$_owner_uid" ]; then
        _owner_uid=$(ls -ldn "$_v_dir" 2>/dev/null | awk 'NR==1 {print $3}')
        case "$_owner_uid" in
            ''|*[!0-9]*) _owner_uid="" ;;
        esac
    fi
    [ -n "$_owner_uid" ] && [ "$_owner_uid" = "$_cur_uid" ] || return 1
    chmod 700 "$_v_dir" 2>/dev/null || return 1
    return 0
}

init_secure_run_dir() {
    if [ "$(id -u)" = "0" ] && [ -d /run ] && [ ! -L /run ]; then
        if verify_secure_dir "/run/cf-probe"; then
            RUN_DIR="/run/cf-probe"
            return 0
        fi
    fi
    if [ "$(id -u)" = "0" ] && [ -d /var/run ] && [ ! -L /var/run ]; then
        if verify_secure_dir "/var/run/cf-probe"; then
            RUN_DIR="/var/run/cf-probe"
            return 0
        fi
    fi
    if verify_secure_dir "${CONFIG_DIR}/run"; then
        RUN_DIR="${CONFIG_DIR}/run"
        return 0
    fi
    echo "[ERROR] 无法初始化受保护的专属运行目录" >&2
    exit 1
}

validate_worker_url() {
    _v_url="${1:-}"
    [ "${#_v_url}" -ge 8 ] || return 1
    case "$_v_url" in
        https://?*|http://?*) ;;
        *) return 1 ;;
    esac
    case "$_v_url" in
        *[[:space:][:cntrl:]\"\'\\\`]*) return 1 ;;
    esac
    return 0
}

run_with_timeout() {
    _t_sec="$1"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout "$_t_sec" "$@"
    else
        "$@"
    fi
}

safe_df_kp() {
    if _df_out=$(run_with_timeout 5 df -lkP "$@" 2>/dev/null) && [ -n "$_df_out" ]; then
        printf '%s\n' "$_df_out"
        return 0
    fi
    run_with_timeout 5 df -kP "$@" 2>/dev/null || true
}

normalize_interface_list() {
    printf '%s' "${1:-}" | awk -F',' '
        BEGIN { out=""; bad=0; total=0 }
        {
            for (i=1; i<=NF; i++) {
                name=$i
                gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", name)
                if (name == "") continue
                if (length(name) > 64 || name !~ /^[A-Za-z0-9_.:-]+$/) { bad=1; next }
                if (!seen[name]++) {
                    out = (out == "" ? name : out "," name)
                    total += length(name)
                }
            }
        }
        END {
            if (bad || length(out) > 255 || total > 255) exit 1
            printf "%s", out
        }'
}

if [ ! -f "${CONFIG_FILE}" ]; then
    echo "[ERROR] 配置文件不存在: ${CONFIG_FILE}"
    exit 1
fi

SERVER_ID=""
SECRET=""
WORKER_URL=""
COLLECT_INTERVAL=""
REPORT_INTERVAL=""
CT_NODE=""
CU_NODE=""
CM_NODE=""
BD_NODE=""
INTERFACE=""
RESET_DAY=""
AUTO_UPDATE=""
CONFIG_MD5=""
ALLOW_INSECURE_HTTP_UPDATE="${ALLOW_INSECURE_HTTP_UPDATE:-0}"
ALLOW_PRIVATE_PROBE="${ALLOW_PRIVATE_PROBE:-0}"

while IFS='=' read -r key value; do
    case "$key" in
        SERVER_ID) SERVER_ID="${value%\"}"; SERVER_ID="${SERVER_ID#\"}" ;;
        SECRET) SECRET="${value%\"}"; SECRET="${SECRET#\"}" ;;
        WORKER_URL) WORKER_URL="${value%\"}"; WORKER_URL="${WORKER_URL#\"}" ;;
        COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
        REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
        CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
        CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
        CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
        BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
        INTERFACE) INTERFACE="${value%\"}"; INTERFACE="${INTERFACE#\"}" ;;
        RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
        AUTO_UPDATE) AUTO_UPDATE="${value%\"}"; AUTO_UPDATE="${AUTO_UPDATE#\"}" ;;
        CONFIG_MD5) CONFIG_MD5="${value%\"}"; CONFIG_MD5="${CONFIG_MD5#\"}" ;;
        ALLOW_INSECURE_HTTP_UPDATE) ALLOW_INSECURE_HTTP_UPDATE="${value%\"}"; ALLOW_INSECURE_HTTP_UPDATE="${ALLOW_INSECURE_HTTP_UPDATE#\"}" ;;
        ALLOW_PRIVATE_PROBE) ALLOW_PRIVATE_PROBE="${value%\"}"; ALLOW_PRIVATE_PROBE="${ALLOW_PRIVATE_PROBE#\"}" ;;
    esac
done < "${CONFIG_FILE}"

verify_secure_dir "${CONFIG_DIR}" || {
    echo "[ERROR] 配置目录权限校验失败: ${CONFIG_DIR}"
    exit 1
}
init_secure_run_dir

INTERFACE=$(normalize_interface_list "${INTERFACE:-}") || INTERFACE=""

to_uint() {
    _num=$(printf '%s' "${1:-0}" | sed 's/^0*//')
    case "${_num}" in
        ''|*[!0-9]*) echo 0 ;;
        ?|??|???|????|?????|??????|???????|????????|?????????) echo "${_num}" ;;
        *) echo 0 ;;
    esac
}

normalize_reset_day() {
    _day=$(printf '%s' "${1:-1}" | sed 's/^0*//')
    case "${_day}" in
        '') echo 0 ;;
        *[!0-9]*) echo 1 ;;
        0|[1-9]|1[0-9]|2[0-9]|30|31) echo "${_day}" ;;
        *) echo 1 ;;
    esac
}

COLLECT_INTERVAL=$(to_uint "${COLLECT_INTERVAL:-0}")
REPORT_INTERVAL=$(to_uint "${REPORT_INTERVAL:-60}")
RESET_DAY=$(normalize_reset_day "${RESET_DAY:-1}")
[ "$REPORT_INTERVAL" -lt 1 ] && REPORT_INTERVAL=60
if [ "$COLLECT_INTERVAL" -gt 0 ] && [ "$REPORT_INTERVAL" -lt "$COLLECT_INTERVAL" ]; then
    REPORT_INTERVAL="$COLLECT_INTERVAL"
fi
ACTIVE_INTERVAL="$REPORT_INTERVAL"
[ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
CONFIG_MD5=${CONFIG_MD5:-none}
AUTO_UPDATE=${AUTO_UPDATE:-0}
case "$AUTO_UPDATE" in
    0|1) ;;
    *) AUTO_UPDATE=0 ;;
esac
DEBUG_MODE=${DEBUG_MODE:-0}

log_ts() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
    echo "[INFO] $(log_ts) $*"
}

log_debug() {
    [ "${DEBUG_MODE:-0}" = "1" ] && echo "[DEBUG] $(log_ts) $*" >&2
    return 0
}

log_warn_debug() {
    [ "${DEBUG_MODE:-0}" = "1" ] && echo "[WARN] $(log_ts) $*"
    return 0
}

get_install_url() {
    validate_worker_url "${WORKER_URL:-}" || return 1
    _u="${WORKER_URL%%\?*}"
    case "$_u" in
        https://*)
            _rest="${_u#https://}"
            _origin="https://${_rest%%/*}"
            ;;
        http://*)
            if [ "${ALLOW_INSECURE_HTTP_UPDATE:-0}" != "1" ]; then
                return 1
            fi
            _rest="${_u#http://}"
            _origin="http://${_rest%%/*}"
            ;;
        *)
            return 1
            ;;
    esac
    case "$_origin" in
        http://|https://) return 1 ;;
    esac
    printf '%s/install-openwrt.sh' "$_origin"
}

schedule_agent_update() {
    if [ "${AUTO_UPDATE}" != "1" ]; then
        log_warn_debug "Auto update ignored: local AUTO_UPDATE=${AUTO_UPDATE}"
        return 0
    fi

    _lock_file="${CONFIG_DIR}/auto_update.lock"
    _now=$(date +%s)
    if [ -f "$_lock_file" ]; then
        _last=$(cat "$_lock_file" 2>/dev/null || echo 0)
        case "$_last" in ''|*[!0-9]*) _last=0 ;; esac
        if awk -v n="$_now" -v l="$_last" 'BEGIN { exit !((n + 0) - (l + 0) < 1800) }'; then
            log_warn_debug "Auto update already scheduled recently: lock=${_lock_file}"
            return 0
        fi
    fi

    verify_secure_dir "${CONFIG_DIR}" || return 1
    if ! _install_url=$(get_install_url); then
        log_warn_debug "Auto update skipped: invalid or non-HTTPS WORKER_URL=${WORKER_URL}"
        return 1
    fi
    log_debug "Auto update requested: install_url=${_install_url}"
    if _lock_tmp=$(umask 077; mktemp "${CONFIG_DIR}/.lock.XXXXXX" 2>/dev/null); then
        printf '%s\n' "$_now" > "$_lock_tmp" && mv -f "$_lock_tmp" "$_lock_file" || rm -f "$_lock_tmp"
    fi

    nohup /bin/sh -c '
        sleep "$3"
        umask 077
        tmp=$(mktemp "$2/.auto_update.XXXXXX") || exit 1
        trap '\''rm -f "$tmp"'\'' EXIT INT TERM
        case "$1" in
            https://*)
                curl -fsSL --proto "=https" --tlsv1.2 --connect-timeout 5 -m 30 -o "$tmp" -- "$1" || exit 1
                ;;
            http://*)
                curl -fsSL --proto "=http,https" --connect-timeout 5 -m 30 -o "$tmp" -- "$1" || exit 1
                ;;
            *)
                exit 1
                ;;
        esac
        [ -s "$tmp" ] || exit 1
        IFS= read -r first_line < "$tmp" || exit 1
        case "$first_line" in
            "#!"/*) ;;
            *) exit 1 ;;
        esac
        /bin/sh "$tmp" install
    ' _ "$_install_url" "${CONFIG_DIR}" "$AUTO_UPDATE_DELAY_SECONDS" >/dev/null 2>&1 &
    log_info "Auto update scheduled after ${AUTO_UPDATE_DELAY_SECONDS}s"
    return 0
}

PROBE_LOG_FILE=""
if [ -L /proc/self/fd/1 ]; then
    _log_target=$(readlink /proc/self/fd/1 2>/dev/null || echo "")
    [ -f "$_log_target" ] && [ -w "$_log_target" ] && PROBE_LOG_FILE="$_log_target"
fi

rotate_log_if_needed() {
    [ -f "$1" ] || return 0
    _sz=$(wc -c < "$1" 2>/dev/null || echo 0)
    awk -v s="${_sz:-0}" 'BEGIN { exit !(s + 0 > 1048576) }' || return 0
    _lines=$(wc -l < "$1" 2>/dev/null || echo 0)
    if [ "${_lines}" -eq 1 ]; then
        : > "$1" 2>/dev/null
        return 0
    fi
    _rot_tmp=$(umask 077; mktemp "${RUN_DIR}/logrot.XXXXXX" 2>/dev/null) || return 0
    tail -c 102400 "$1" > "$_rot_tmp" 2>/dev/null || { rm -f "$_rot_tmp"; return 0; }
    : > "$1" 2>/dev/null
    cat "$_rot_tmp" >> "$1" 2>/dev/null || true
    rm -f "$_rot_tmp" 2>/dev/null || true
}

persist_dynamic_config() {
    _cfg_tmp=$(umask 077; mktemp "${CONFIG_FILE}.tmp.XXXXXX" 2>/dev/null) || return 1
    if ! (umask 077; awk -v collect="$1" -v report="$2" -v reset="$3" -v md5="$4" -v ct="$5" -v cu="$6" -v cm="$7" -v bd="$8" -v iface="$9" '
        BEGIN { c=0; r=0; d=0; m=0; tct=0; tcu=0; tcm=0; tbd=0; ni=0 }
        /^COLLECT_INTERVAL=/ { print "COLLECT_INTERVAL=\"" collect "\""; c=1; next }
        /^REPORT_INTERVAL=/ { print "REPORT_INTERVAL=\"" report "\""; r=1; next }
        /^RESET_DAY=/ { print "RESET_DAY=\"" reset "\""; d=1; next }
        /^CONFIG_MD5=/ { print "CONFIG_MD5=\"" md5 "\""; m=1; next }
        /^CT_NODE=/ { print "CT_NODE=\"" ct "\""; tct=1; next }
        /^CU_NODE=/ { print "CU_NODE=\"" cu "\""; tcu=1; next }
        /^CM_NODE=/ { print "CM_NODE=\"" cm "\""; tcm=1; next }
        /^BD_NODE=/ { print "BD_NODE=\"" bd "\""; tbd=1; next }
        /^INTERFACE=/ { print "INTERFACE=\"" iface "\""; ni=1; next }
        { print }
        END {
            if (!c) print "COLLECT_INTERVAL=\"" collect "\""
            if (!r) print "REPORT_INTERVAL=\"" report "\""
            if (!d) print "RESET_DAY=\"" reset "\""
            if (!m) print "CONFIG_MD5=\"" md5 "\""
            if (!tct) print "CT_NODE=\"" ct "\""
            if (!tcu) print "CU_NODE=\"" cu "\""
            if (!tcm) print "CM_NODE=\"" cm "\""
            if (!tbd) print "BD_NODE=\"" bd "\""
            if (!ni) print "INTERFACE=\"" iface "\""
        }
    ' "$CONFIG_FILE" > "$_cfg_tmp"); then
        rm -f "$_cfg_tmp"
        return 1
    fi
    chmod 600 "$_cfg_tmp" 2>/dev/null || true
    mv -f "$_cfg_tmp" "$CONFIG_FILE"
}

apply_remote_config() {
    _rc_resp="$1"
    _rc_hdr="$2"
    _rc_bytes=$(wc -c < "$_rc_resp" 2>/dev/null || echo 9999)
    if [ "$_rc_bytes" -gt 1024 ]; then
        log_warn_debug "Remote config rejected: response too large bytes=${_rc_bytes}"
        return 1
    fi
    _rc_body=$(cat "$_rc_resp" 2>/dev/null) || return 1
    log_debug "Remote config raw: bytes=${_rc_bytes} body=${_rc_body}"
    case "$_rc_body" in
        '') log_warn_debug "Remote config rejected: empty body"; return 1 ;;
        *[!A-Za-z0-9_=\&.,:-]*) log_warn_debug "Remote config rejected: invalid characters body=${_rc_body}"; return 1 ;;
    esac

    _c_collect=""
    _c_report=""
    _c_reset=""
    _c_schema=""
    _c_ct=""
    _c_cu=""
    _c_cm=""
    _c_bd=""
    _c_iface=""
    _c_rx=""
    _c_tx=""
    _c_upd=""
    _saved_ifs="$IFS"
    IFS='&'
    for _f in $_rc_body; do
        _k="${_f%%=*}"; _v="${_f#*=}"
        case "$_k" in
            collect_interval) _c_collect="$_v" ;;
            report_interval)  _c_report="$_v" ;;
            reset_day)        _c_reset="$_v" ;;
            schema_version)   _c_schema="$_v" ;;
            custom_ct)        _c_ct="$_v" ;;
            custom_cu)        _c_cu="$_v" ;;
            custom_cm)        _c_cm="$_v" ;;
            custom_bd)        _c_bd="$_v" ;;
            interface)        _c_iface="$_v" ;;
            rx_correction)    _c_rx="$_v" ;;
            tx_correction)    _c_tx="$_v" ;;
            update)           _c_upd="$_v" ;;
            '')               ;;
            *)                IFS="$_saved_ifs"; log_warn_debug "Remote config rejected: unknown field=${_k}"; return 1 ;;
        esac
    done
    IFS="$_saved_ifs"

    _has_cfg=0
    if [ -n "$_c_collect" ] || [ -n "$_c_report" ] || [ -n "$_c_reset" ] || [ -n "$_c_schema" ] || [ -n "$_c_iface" ]; then
        _has_cfg=1
    fi

    if [ "$_has_cfg" = "0" ]; then
        if [ "$_c_upd" = "1" ]; then
            log_debug "Remote update-only instruction received"
            schedule_agent_update
            return 0
        fi
        log_warn_debug "Remote config rejected: no config fields and update=${_c_upd:-}"
        return 1
    fi

    _c_md5=$(awk 'tolower($1)=="x-agent-config-md5:" { gsub("\r", "", $2); print tolower($2); exit }' "$_rc_hdr")
    if [ "${#_c_md5}" -ne 32 ]; then
        log_warn_debug "Remote config rejected: invalid md5 length md5=${_c_md5:-}"
        return 1
    fi
    case "$_c_md5" in *[!0-9a-f]*) log_warn_debug "Remote config rejected: invalid md5 chars md5=${_c_md5}"; return 1 ;; esac

    case "$_c_collect" in 0|1|2|5|10) ;; *) log_warn_debug "Remote config rejected: invalid collect_interval=${_c_collect:-}"; return 1 ;; esac
    case "$_c_report" in 30|60|120|180) ;; *) log_warn_debug "Remote config rejected: invalid report_interval=${_c_report:-}"; return 1 ;; esac
    case "$_c_reset" in 0|[1-9]|1[0-9]|2[0-9]|30|31) ;; *) log_warn_debug "Remote config rejected: invalid reset_day=${_c_reset:-}"; return 1 ;; esac
    case "$_c_upd" in ''|0|1) ;; *) log_warn_debug "Remote config rejected: invalid update=${_c_upd}"; return 1 ;; esac
    if [ "$_c_schema" != "3" ]; then
        log_warn_debug "Remote config rejected: invalid schema_version=${_c_schema:-}"
        return 1
    fi
    _c_iface=$(normalize_interface_list "${_c_iface:-}") || { log_warn_debug "Remote config rejected: invalid interface=${_c_iface:-}"; return 1; }
    if [ "$_c_report" -lt "$_c_collect" ]; then
        log_warn_debug "Remote config rejected: report_interval=${_c_report} less than collect_interval=${_c_collect}"
        return 1
    fi

    if [ "$_c_md5" != "${CONFIG_MD5:-none}" ]; then
        persist_dynamic_config "$_c_collect" "$_c_report" "$_c_reset" "$_c_md5" "$_c_ct" "$_c_cu" "$_c_cm" "$_c_bd" "$_c_iface" || return 1
        COLLECT_INTERVAL="$_c_collect"
        REPORT_INTERVAL="$_c_report"
        RESET_DAY="$_c_reset"
        CT_NODE="$_c_ct"
        CU_NODE="$_c_cu"
        CM_NODE="$_c_cm"
        BD_NODE="$_c_bd"
        INTERFACE="$_c_iface"
        CONFIG_MD5="$_c_md5"
        ACTIVE_INTERVAL="$REPORT_INTERVAL"
        [ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
        NET_STAT=$(get_net_bytes)
        RX_PREV=$(echo "$NET_STAT" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
        TX_PREV=$(echo "$NET_STAT" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}
        PREV_LOOP_TIME=$(date +%s)
        log_info "Dynamic configuration applied: md5=${CONFIG_MD5} interface=${INTERFACE:-auto} ct=${CT_NODE:-} cu=${CU_NODE:-} cm=${CM_NODE:-} bd=${BD_NODE:-}"

        if kill -0 "$WORKER_PID" 2>/dev/null; then
            pkill -P "$WORKER_PID" 2>/dev/null || true
            kill "$WORKER_PID" 2>/dev/null || true
            wait "$WORKER_PID" 2>/dev/null || true
        fi
        rm -f "${RUN_DIR}"/probe_* 2>/dev/null || true
        run_network_worker &
        WORKER_PID=$!

        if [ "$COLLECT_INTERVAL" -gt 0 ]; then
            SAMPLES_JSON=""
            SAMPLE_COUNT=0
        fi
        LAST_REPORT_TIME=0
    fi

    if [ -n "$_c_rx" ] || [ -n "$_c_tx" ]; then
        if apply_traffic_correction "$_c_rx" "$_c_tx"; then
            send_correction_confirm "$_c_rx" "$_c_tx" || true
        fi
    fi

    if [ "$_c_upd" = "1" ]; then
        log_debug "Remote config includes update=1"
        schedule_agent_update || true
    fi
    return 0
}

escape_json() {
    printf '%sX\n' "${1:-}" | tr -d '\000-\007\013\016-\037\177' | awk '
        BEGIN {
            bs = sprintf("%c", 92)
            dq = sprintf("%c", 34)
            ch_b = sprintf("%c", 8)
            ch_t = sprintf("%c", 9)
            ch_n = sprintf("%c", 10)
            ch_f = sprintf("%c", 12)
            ch_r = sprintf("%c", 13)
        }
        {
            acc = (NR == 1 ? $0 : acc ch_n $0)
        }
        END {
            acc = substr(acc, 1, length(acc) - 1)
            out = ""
            len = length(acc)
            for (i = 1; i <= len; i++) {
                c = substr(acc, i, 1)
                if (c == bs) out = out bs bs
                else if (c == dq) out = out bs dq
                else if (c == ch_b) out = out bs "b"
                else if (c == ch_f) out = out bs "f"
                else if (c == ch_n) out = out bs "n"
                else if (c == ch_r) out = out bs "r"
                else if (c == ch_t) out = out bs "t"
                else out = out c
            }
            printf "%s", out
        }
    '
}

normalize_correction_value() {
    _corr_val="${1:-0}"
    [ -z "$_corr_val" ] && _corr_val=0
    printf '%s' "$_corr_val"
}

is_valid_correction_value() {
    _check_val=$(normalize_correction_value "$1")
    awk -v v="$_check_val" -v max="$MAX_TRAFFIC_CORRECTION_GB" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v + 0 >= 0 && v + 0 <= max) }'
}

send_correction_confirm() {
    _ack_rx=$(normalize_correction_value "$1")
    _ack_tx=$(normalize_correction_value "$2")
    is_valid_correction_value "$_ack_rx" && is_valid_correction_value "$_ack_tx" || return 1
    _esid=$(escape_json "$SERVER_ID")
    _esec=$(escape_json "$SECRET")
    _ack_payload="{\"id\":\"$_esid\",\"secret\":\"$_esec\",\"rx_correction\":$_ack_rx,\"tx_correction\":$_ack_tx}"
    _ack_http=$(printf '%s' "$_ack_payload" | curl -sS -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        --data-binary @- -m 4 --connect-timeout 2 -- "$WORKER_URL" 2>/dev/null || echo 000)
    case "$_ack_http" in ''|*[!0-9]*) _ack_http=000 ;; esac
    if [ "$_ack_http" -ge 200 ] && [ "$_ack_http" -lt 300 ]; then
        log_info "Traffic correction confirm sent: RX=${_ack_rx}GB TX=${_ack_tx}GB"
        return 0
    fi
    log_warn_debug "Traffic correction confirm failed: http=${_ack_http} RX=${_ack_rx}GB TX=${_ack_tx}GB"
    return 1
}

apply_traffic_correction() {
    _rx_val="${1:-0}"
    _tx_val="${2:-0}"
    [ -z "$_rx_val" ] && _rx_val=0
    [ -z "$_tx_val" ] && _tx_val=0
    is_valid_correction_value "$_rx_val" && is_valid_correction_value "$_tx_val" || return 1
    _rx_bytes=$(printf '%s' "$_rx_val" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
    _tx_bytes=$(printf '%s' "$_tx_val" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
    _saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        while IFS='=' read -r key value; do
            case "$key" in
                PERIOD_START) _saved_period_start="${value%%\"*}"; _saved_period_start="${_saved_period_start#\"}" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
    fi
    _now_ts=$(date +%s)
    _current_net=$(get_net_bytes)
    _saved_rx_prev=$(echo "$_current_net" | awk '{print $1}'); _saved_rx_prev=${_saved_rx_prev:-0}
    _saved_tx_prev=$(echo "$_current_net" | awk '{print $2}'); _saved_tx_prev=${_saved_tx_prev:-0}
    log_info "Traffic correction applied: RX=${_rx_val}GB (${_rx_bytes} bytes) TX=${_tx_val}GB (${_tx_bytes} bytes)"
    if _tmp_tf=$(umask 077; mktemp "${TRAFFIC_DATA_FILE}.tmp.XXXXXX" 2>/dev/null); then
        cat > "$_tmp_tf" << EOF
RX_PREV=${_saved_rx_prev}
TX_PREV=${_saved_tx_prev}
RX_PERIOD=${_rx_bytes}
TX_PERIOD=${_tx_bytes}
LAST_CHECK=${_now_ts}
PERIOD_START=${_saved_period_start}
INTERFACE=${INTERFACE:-}
EOF
        mv -f "$_tmp_tf" "${TRAFFIC_DATA_FILE}" 2>/dev/null || rm -f "$_tmp_tf"
    fi
}

json_probe_value() {
    if [ -z "${1:-}" ]; then
        printf 'false'
    else
        printf '"%s"' "$(escape_json "${2:-}")"
    fi
}

# 使用 awk 64 位双精度浮点做大数除法，防止 32 位 BusyBox ash $((...)) 在 2.14GB 处溢出
safe_div() {
    awk -v num="${1:-0}" -v den="${2:-0}" -v def="${3:-0}" '
        BEGIN {
            if (den + 0 == 0) printf "%.0f\n", def + 0
            else printf "%.0f\n", int((num + 0) / (den + 0))
        }
    '
}

get_net_bytes() {
    awk -v interfaces="${INTERFACE:-}" '
        BEGIN {
            split(interfaces, parts, ",")
            for (i in parts) if (parts[i] != "") wanted[parts[i]] = 1
        }
        NR > 2 {
            iface=$1
            sub(/:$/, "", iface)
            if (interfaces != "") {
                if (wanted[iface]) { rx += $2; tx += $10 }
            } else if ($1 ~ /^(eth|en|wl)[a-z0-9]*:/) {
                rx += $2; tx += $10
            }
        }
        END { printf "%.0f %.0f\n", rx+0, tx+0 }
    ' /proc/net/dev 2>/dev/null || echo "0 0"
}

is_leap_year() {
    _ly_year=$1
    [ $((_ly_year % 4)) -eq 0 ] && [ $((_ly_year % 100)) -ne 0 ] || [ $((_ly_year % 400)) -eq 0 ]
}

to_decimal() {
    _dec_val=$(printf '%s' "${1:-0}" | sed 's/^0*//')
    case "$_dec_val" in ''|*[!0-9]*) _dec_val=0 ;; esac
    printf '%s' "$_dec_val"
}

get_period_start_ts() {
    _p_reset_day=$(normalize_reset_day "${1:-1}")
    [ "$_p_reset_day" -eq 0 ] 2>/dev/null && { echo "0"; return; }
    _p_now_ts="$2"

    _date_parts=$(awk -v ts="$_p_now_ts" '
    BEGIN {
        secs = ts + 0; y = 1970
        while (1) {
            leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
            days_year = leap ? 366 : 365
            if (secs < days_year * 86400) break
            secs -= days_year * 86400; y++
        }
        mdays[1]=31; mdays[2]=leap?29:28; mdays[3]=31; mdays[4]=30
        mdays[5]=31; mdays[6]=30; mdays[7]=31; mdays[8]=31
        mdays[9]=30; mdays[10]=31; mdays[11]=30; mdays[12]=31
        m = 1
        while (m <= 12) {
            if (secs < mdays[m] * 86400) break
            secs -= mdays[m] * 86400; m++
        }
        day = int(secs / 86400) + 1
        printf "%04d %02d %02d\n", y, m, day
    }')
    _p_year=$(echo "$_date_parts" | awk '{print $1}')
    _p_month=$(echo "$_date_parts" | awk '{print $2}')
    _p_day=$(echo "$_date_parts" | awk '{print $3}')
    _p_month=$(to_decimal "$_p_month")
    _p_day=$(to_decimal "$_p_day")
    _target_day=$(to_decimal "$_p_reset_day")

    case "$_p_month" in
        2)
            if is_leap_year "$_p_year"; then
                [ "$_target_day" -gt 29 ] && _target_day=29
            else
                [ "$_target_day" -gt 28 ] && _target_day=28
            fi
            ;;
        4|6|9|11)
            [ "$_target_day" -gt 30 ] && _target_day=30
            ;;
    esac

    if [ "$_p_day" -ge "$_target_day" ]; then
        _period_start_ts=$(awk -v y="$_p_year" -v m="$_p_month" -v d="$_target_day" 'BEGIN{
            y += 0; m += 0; d += 0;
            if(m<=2){y=y-1;m=m+12}
            A=int(y/100);B=2-A+int(A/4);
            JD=int(365.25*(y+4716))+int(30.6001*(m+1))+d+B-1524.5;
            printf "%.0f", (JD-2440587.5)*86400
        }')
    else
        _prev_month=$((_p_month - 1))
        [ "$_prev_month" -eq 0 ] && { _prev_month=12; _p_year=$((_p_year - 1)); }
        case "$_prev_month" in
            2)
                if is_leap_year "$_p_year"; then
                    [ "$_target_day" -gt 29 ] && _target_day=29
                else
                    [ "$_target_day" -gt 28 ] && _target_day=28
                fi
                ;;
            4|6|9|11) [ "$_target_day" -gt 30 ] && _target_day=30 ;;
        esac
        _period_start_ts=$(awk -v y="$_p_year" -v m="$_prev_month" -v d="$_target_day" 'BEGIN{
            y += 0; m += 0; d += 0;
            if(m<=2){y=y-1;m=m+12}
            A=int(y/100);B=2-A+int(A/4);
            JD=int(365.25*(y+4716))+int(30.6001*(m+1))+d+B-1524.5;
            printf "%.0f", (JD-2440587.5)*86400
        }')
    fi

    echo "$_period_start_ts"
}

# 全程通过 awk 64 位浮点运算字节级流量，消除 32 位 BusyBox ash 在 2.14GB 处的有符号整数溢出
calc_monthly_traffic() {
    _cm_cur_rx="$1"
    _cm_cur_tx="$2"
    _cm_reset_day="${RESET_DAY:-1}"
    _cm_now_ts=$(date '+%s')

    _s_rx_prev=0; _s_tx_prev=0; _s_rx_period=0; _s_tx_period=0
    _s_last_check=0; _s_period_start=0; _s_iface=""
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        while IFS='=' read -r key value; do
            case "$key" in
                RX_PREV) _s_rx_prev="$value" ;;
                TX_PREV) _s_tx_prev="$value" ;;
                RX_PERIOD) _s_rx_period="$value" ;;
                TX_PERIOD) _s_tx_period="$value" ;;
                LAST_CHECK) _s_last_check="$value" ;;
                PERIOD_START) _s_period_start="$value" ;;
                INTERFACE) _s_iface="$value" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
        _s_rx_prev=${_s_rx_prev:-0}; _s_tx_prev=${_s_tx_prev:-0}
        _s_rx_period=${_s_rx_period:-0}; _s_tx_period=${_s_tx_period:-0}
        _s_last_check=${_s_last_check:-0}; _s_period_start=${_s_period_start:-0}
    fi

    if [ "${_s_iface}" != "${INTERFACE:-}" ]; then
        _s_rx_prev=0; _s_tx_prev=0
        _s_rx_period=0; _s_tx_period=0
        _s_last_check=0; _s_period_start=0
    fi

    _cm_period_start=$(get_period_start_ts "$_cm_reset_day" "$_cm_now_ts")
    case "$_cm_period_start" in ''|*[!0-9]*) _cm_period_start=0 ;; esac

    _traffic_calc=$(awk \
        -v cur_rx="$_cm_cur_rx" \
        -v cur_tx="$_cm_cur_tx" \
        -v prev_rx="$_s_rx_prev" \
        -v prev_tx="$_s_tx_prev" \
        -v per_rx="$_s_rx_period" \
        -v per_tx="$_s_tx_period" \
        -v last_chk="$_s_last_check" \
        -v per_start="$_cm_period_start" \
        -v saved_start="$_s_period_start" '
        BEGIN {
            crx = cur_rx + 0; ctx = cur_tx + 0
            prx = prev_rx + 0; ptx = prev_tx + 0
            srx = per_rx + 0; stx = per_tx + 0
            if (last_chk + 0 != 0) {
                if (crx < prx || ctx < ptx) {
                    drx = 0; dtx = 0
                } else {
                    drx = crx - prx; dtx = ctx - ptx
                }
                if (per_start + 0 != 0 && per_start + 0 != saved_start + 0 && saved_start + 0 != 0) {
                    srx = drx; stx = dtx
                } else {
                    srx = srx + drx; stx = stx + dtx
                }
            } else {
                srx = 0; stx = 0
            }
            if (srx < 0) srx = 0
            if (stx < 0) stx = 0
            printf "%.0f %.0f\n", srx, stx
        }
    ')
    _s_rx_period=$(printf '%s' "$_traffic_calc" | awk '{print $1}')
    _s_tx_period=$(printf '%s' "$_traffic_calc" | awk '{print $2}')

    if _tmp_tf=$(umask 077; mktemp "${TRAFFIC_DATA_FILE}.tmp.XXXXXX" 2>/dev/null); then
        cat > "$_tmp_tf" << EOF
RX_PREV=${_cm_cur_rx}
TX_PREV=${_cm_cur_tx}
RX_PERIOD=${_s_rx_period}
TX_PERIOD=${_s_tx_period}
LAST_CHECK=${_cm_now_ts}
PERIOD_START=${_cm_period_start}
INTERFACE=${INTERFACE:-}
EOF
        mv -f "$_tmp_tf" "${TRAFFIC_DATA_FILE}" 2>/dev/null || rm -f "$_tmp_tf"
    fi

    echo "$_s_rx_period $_s_tx_period"
}

get_cpu_stat() {
    awk '/^cpu /{total=$2+$3+$4+$5+$6+$7+$8+$9;idle=$5+$6;printf "%.0f %.0f\n",total,idle}' /proc/stat 2>/dev/null || echo "0 0"
}

get_time_ms() {
    _ts=$(date +%s%3N 2>/dev/null || true)
    case "${_ts}" in
        ''|*[!0-9]*) ;;
        ?????????????) echo "${_ts}"; return 0 ;;
        ??????????????*) printf '%.13s\n' "${_ts}"; return 0 ;;
    esac

    _ts=$(date +%s%N 2>/dev/null || true)
    case "${_ts}" in
        ''|*[!0-9]*) ;;
        ???????????????????) printf '%.13s\n' "${_ts}"; return 0 ;;
    esac

    if [ -r /proc/uptime ]; then
        awk '{ printf "%.0f\n", ($1 + 0) * 1000 }' /proc/uptime 2>/dev/null && return 0
    fi

    if command -v perl >/dev/null 2>&1; then
        perl -MTime::HiRes=time -e 'printf "%.0f\n", time() * 1000' 2>/dev/null && return 0
    fi
    return 1
}

has_nc_zero_io() {
    command -v nc >/dev/null 2>&1 || return 1
    nc -h 2>&1 | grep -q -e '-z' || return 1
    nc -h 2>&1 | grep -q -e '-w' || return 1
}

get_tcp_ping_nc() {
    _nc_host="${1:-}"
    _nc_port="${2:-443}"

    _nc_start=$(get_time_ms) || return 1
    if nc -z -w 2 "${_nc_host}" "${_nc_port}" >/dev/null 2>&1; then
        _nc_end=$(get_time_ms) || return 1
        awk -v e="$_nc_end" -v s="$_nc_start" 'BEGIN { d = (e + 0) - (s + 0); if (d < 1) d = 1; printf "%.0f\n", d }'
        return 0
    fi
    return 1
}

split_probe_target() (
    target="${1:-}"
    default_port="${2:-443}"
    probe_host="$target"
    probe_port="$default_port"

    case "$target" in
        ''|*[!A-Za-z0-9._:-]*) exit 1 ;;
        ::1)
            probe_host="::1"
            probe_port="$default_port"
            ;;
        *:*)
            case "${target#*:}" in *:*) exit 1 ;; esac
            probe_host="${target%:*}"
            probe_port="${target##*:}"
            ;;
    esac

    case "$probe_host" in ''|-*) exit 1 ;; esac
    if [ "${ALLOW_PRIVATE_PROBE:-0}" != "1" ]; then
        host_lc=$(printf '%s' "$probe_host" | tr '[:upper:]' '[:lower:]')
        case "$host_lc" in
            localhost|*.localhost|ip6-localhost|ip6-loopback|127.*|169.254.*|0.0.0.0|0.*|::1|::|fe80:*)
                exit 1
                ;;
        esac
    fi
    case "$probe_port" in ''|*[!0-9]*|??????*) exit 1 ;; esac
    [ "$probe_port" -ge 1 ] && [ "$probe_port" -le 65535 ] || exit 1

    printf '%s %s\n' "$probe_host" "$probe_port"
)

parse_ping_avg() {
    awk -F'=' '
        /(^|[[:space:]])(rtt|round-trip)[[:space:]]/ && NF >= 2 {
            rhs = $2
            gsub(/^[[:space:]]+/, "", rhs)
            n = split(rhs, parts, "/")
            if (n >= 2 && parts[2] ~ /^[0-9]+([.][0-9]+)?$/) {
                printf "%d", int(parts[2])
                exit
            }
        }
    '
}

get_probe() {
    _p_target="${1:-}"
    _p_count="${2:-4}"
    _p_port="${3:-443}"

    if [ -z "$_p_target" ]; then
        echo "null 100"
        return
    fi

    if ! _probe_target=$(split_probe_target "$_p_target" "$_p_port"); then
        echo "null 100"
        return
    fi
    _p_host="${_probe_target% *}"
    _p_port="${_probe_target##* }"

    if has_nc_zero_io && get_time_ms >/dev/null 2>&1; then
        _ok=0
        _vals=""
        _i=1
        while [ "$_i" -le "$_p_count" ]; do
            _rtt=$(get_tcp_ping_nc "$_p_host" "$_p_port" 2>/dev/null || echo "")
            if [ -n "$_rtt" ]; then
                _ok=$((_ok + 1))
                _vals="$_vals $_rtt"
            fi
            _i=$((_i + 1))
        done
        if [ "$_ok" -gt 0 ]; then
            _sorted=$(echo "$_vals" | tr ' ' '\n' | grep -v '^$' | sort -n)
            if [ $((_ok % 2)) -eq 1 ]; then
                _med=$(echo "$_sorted" | sed -n "$(( (_ok + 1) / 2 ))p")
            else
                _a=$(echo "$_sorted" | sed -n "$(( _ok / 2 ))p")
                _b=$(echo "$_sorted" | sed -n "$(( _ok / 2 + 1 ))p")
                _med=$(awk -v a="$_a" -v b="$_b" 'BEGIN { printf "%.0f", int(((a + 0) + (b + 0)) / 2) }')
            fi
            echo "$_med $(( (_p_count - _ok) * 100 / _p_count ))"
        else
            echo "null 100"
        fi
        return
    fi

    _icmp_out=$(ping -c "$_p_count" -W 2 -- "$_p_host" 2>/dev/null || ping -c "$_p_count" -W 2 "$_p_host" 2>/dev/null || true)
    _avg_rtt=$(printf '%s\n' "$_icmp_out" | parse_ping_avg)
    _loss=$(printf '%s\n' "$_icmp_out" | awk '/packet loss/{for(i=1;i<=NF;i++) if($i~/^[0-9]+(\.[0-9]+)?%$/){sub(/%/,"",$i);printf "%d",int($i);exit}}')
    [ -z "$_avg_rtt" ] && _avg_rtt="null"
    [ -z "$_loss" ] && _loss=100
    echo "$_avg_rtt $_loss"
}

CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

write_probe_result() {
    _w_dest="$1"
    shift
    _w_tmp=$(umask 077; mktemp "${_w_dest}.XXXXXX" 2>/dev/null) || return 0
    "$@" > "$_w_tmp" 2>/dev/null || true
    if [ -s "$_w_tmp" ]; then
        mv -f "$_w_tmp" "$_w_dest"
    else
        rm -f "$_w_tmp" "$_w_dest"
    fi
    return 0
}

is_valid_ipv4() {
    _v4="${1:-}"
    [ "${#_v4}" -le 15 ] || return 1
    printf '%s' "$_v4" | awk -F'.' '
        NF == 4 &&
        $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ &&
        $1 + 0 <= 255 && $2 + 0 <= 255 && $3 + 0 <= 255 && $4 + 0 <= 255 { ok = 1 }
        END { exit !ok }
    '
}

is_valid_ipv6() {
    _v6="${1:-}"
    [ "${#_v6}" -ge 2 ] && [ "${#_v6}" -le 45 ] || return 1
    case "$_v6" in
        *:*) ;;
        *) return 1 ;;
    esac
    case "$_v6" in
        *[!0-9a-fA-F:.]*) return 1 ;;
    esac
    return 0
}

get_cf_trace_ip() {
    _fam="$1"
    _ip_val=$(curl "$_fam" --noproxy cloudflare.com -s -m 5 --connect-timeout 5 -- "https://cloudflare.com/cdn-cgi/trace" 2>/dev/null | awk -F= '$1 == "ip" { gsub(/[\r\n[:space:]]/, "", $2); print $2; exit }') || _ip_val=""
    if [ "$_fam" = "-4" ]; then
        if is_valid_ipv4 "$_ip_val"; then
            printf '%s\n' "$_ip_val"
            return 0
        fi
    else
        if is_valid_ipv6 "$_ip_val"; then
            printf '%s\n' "$_ip_val"
            return 0
        fi
    fi
    printf '0\n'
}

refresh_probe_async() {
    [ -n "$CT_NODE" ] && write_probe_result "${RUN_DIR}/probe_ct" get_probe "$CT_NODE" 4 443 &
    [ -n "$CU_NODE" ] && write_probe_result "${RUN_DIR}/probe_cu" get_probe "$CU_NODE" 4 443 &
    [ -n "$CM_NODE" ] && write_probe_result "${RUN_DIR}/probe_cm" get_probe "$CM_NODE" 4 443 &
    [ -n "$BD_NODE" ] && write_probe_result "${RUN_DIR}/probe_bd" get_probe "$BD_NODE" 4 443 &
    wait || true
    return 0
}

run_network_worker() {
    set -eu
    last_ip=0
    last_probe=0
    probe_interval="${REPORT_INTERVAL:-60}"
    case "$probe_interval" in ''|*[!0-9]*) probe_interval=60 ;; esac
    [ "$probe_interval" -lt 30 ] && probe_interval=30
    [ "$probe_interval" -gt 60 ] && probe_interval=60

    while true; do
        now=$(date +%s)

        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            if _ipv4_tmp=$(umask 077; mktemp "${RUN_DIR}/.ipv4.XXXXXX" 2>/dev/null); then
                get_cf_trace_ip "-4" > "$_ipv4_tmp" && mv -f "$_ipv4_tmp" "${RUN_DIR}/ipv4" || rm -f "$_ipv4_tmp"
            fi
            if _ipv6_tmp=$(umask 077; mktemp "${RUN_DIR}/.ipv6.XXXXXX" 2>/dev/null); then
                (if ip -6 route show default >/dev/null 2>&1; then get_cf_trace_ip "-6"; else echo "0"; fi) > "$_ipv6_tmp" && mv -f "$_ipv6_tmp" "${RUN_DIR}/ipv6" || rm -f "$_ipv6_tmp"
            fi
            last_ip="$now"
        fi

        if [ $((now - last_probe)) -ge "$probe_interval" ] || [ "$last_probe" -eq 0 ]; then
            refresh_probe_async
            last_probe="$now"
        fi
        sleep 5
    done
}

if [ -z "${SERVER_ID:-}" ] || [ -z "${SECRET:-}" ] || [ -z "${WORKER_URL:-}" ]; then
    echo "[ERROR] 配置缺失: SERVER_ID/SECRET/WORKER_URL 不能为空"
    exit 1
fi
if ! validate_worker_url "${WORKER_URL}"; then
    echo "[ERROR] WORKER_URL 非法: 必须以 https:// 或 http:// 开头且不含空白或引号"
    exit 1
fi

NET_STAT=$(get_net_bytes)
RX_PREV=$(echo "$NET_STAT" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
TX_PREV=$(echo "$NET_STAT" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}

CPU_STAT=$(get_cpu_stat)
PREV_CPU_TOTAL=$(echo "$CPU_STAT" | awk '{print $1}'); PREV_CPU_TOTAL=${PREV_CPU_TOTAL:-0}
PREV_CPU_IDLE=$(echo "$CPU_STAT" | awk '{print $2}'); PREV_CPU_IDLE=${PREV_CPU_IDLE:-0}

PREV_LOOP_TIME=$(date +%s)

DISK_CHECK_INTERVAL=120
LAST_DISK_CHECK=0
STATUS_CHECK_INTERVAL=60
LAST_STATUS_CHECK=0

DISK_TOTAL=0; DISK_USED=0
OS=""; ARCH=""; KERNEL_VERSION=""; BOOT_TIME=0; CPU_INFO=""; CPU_CORES=1
LOAD_AVG="0 0 0"; PROCESSES=0; TCP_CONN=0; UDP_CONN=0
RX_MONTHLY=0; TX_MONTHLY=0

echo "[INFO] CF-Server-Monitor Probe Engine Started Successfully."

run_network_worker &
WORKER_PID=$!
SAMPLES_JSON=""
SAMPLE_COUNT=0
LAST_REPORT_TIME=0

while true; do
    LOOP_START_TIME=$(date +%s)
    rotate_log_if_needed "$PROBE_LOG_FILE"

    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
        run_network_worker &
        WORKER_PID=$!
    fi

    _mem_calc=$(awk '
        /^MemTotal:/ { mt = $2 }
        /^MemAvailable:/ { ma = $2 }
        /^MemFree:/ { mf = $2 }
        /^Buffers:/ { mb = $2 }
        /^Cached:/ { mc = $2 }
        /^SwapTotal:/ { st = $2 }
        /^SwapFree:/ { sf = $2 }
        END {
            if (ma + 0 == 0) ma = (mf + 0) + (mb + 0) + (mc + 0)
            rt = int((mt + 0) / 1024)
            ru = int(((mt + 0) - (ma + 0)) / 1024)
            if (ru < 0) ru = 0
            swt = int((st + 0) / 1024)
            swu = int(((st + 0) - (sf + 0)) / 1024)
            if (swu < 0) swu = 0
            printf "%.0f %.0f %.0f %.0f\n", rt, ru, swt, swu
        }
    ' /proc/meminfo 2>/dev/null || echo "0 0 0 0")
    RAM_TOTAL=$(printf '%s' "$_mem_calc" | awk '{print $1}')
    RAM_USED=$(printf '%s' "$_mem_calc" | awk '{print $2}')
    SWAP_TOTAL=$(printf '%s' "$_mem_calc" | awk '{print $3}')
    SWAP_USED=$(printf '%s' "$_mem_calc" | awk '{print $4}')

    if [ $((LOOP_START_TIME - LAST_DISK_CHECK)) -ge "${DISK_CHECK_INTERVAL}" ] || [ "${LAST_DISK_CHECK}" -eq 0 ]; then
        DISK_INFO=$(safe_df_kp / | tail -n 1 || echo "")
        DISK_TOTAL=0; DISK_USED=0
        if [ -n "${DISK_INFO}" ]; then
            DISK_TOTAL=$(echo "${DISK_INFO}" | awk '{printf "%.0f", int($2/1024)}')
            DISK_USED=$(echo "${DISK_INFO}" | awk '{printf "%.0f", int($3/1024)}')
        fi
        LAST_DISK_CHECK="${LOOP_START_TIME}"
    fi

    CPU_STAT=$(get_cpu_stat)
    CPU_TOTAL_NOW=$(echo "$CPU_STAT" | awk '{print $1}'); CPU_TOTAL_NOW=${CPU_TOTAL_NOW:-0}
    CPU_IDLE_NOW=$(echo "$CPU_STAT" | awk '{print $2}'); CPU_IDLE_NOW=${CPU_IDLE_NOW:-0}
    CPU=$(awk -v tn="${CPU_TOTAL_NOW}" -v tp="${PREV_CPU_TOTAL}" -v inow="${CPU_IDLE_NOW}" -v ip="${PREV_CPU_IDLE}" '
        BEGIN {
            dt = (tn + 0) - (tp + 0)
            di = (inow + 0) - (ip + 0)
            if (dt <= 0) {
                printf "0.00"
            } else {
                p = (1 - di / dt) * 100
                if (p < 0) p = 0
                if (p > 100) p = 100
                printf "%.2f", p
            }
        }
    ')
    PREV_CPU_TOTAL=${CPU_TOTAL_NOW}
    PREV_CPU_IDLE=${CPU_IDLE_NOW}

    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "$NET_STAT" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "$NET_STAT" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}

    if [ "${LAST_STATUS_CHECK}" -eq 0 ]; then
        if [ -f /etc/os-release ]; then
            OS_RAW=$(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'" || true)
        else
            OS_RAW=$(uname -srm)
        fi
        OS=${OS_RAW:-"OpenWrt"}
        ARCH=$(uname -m)
        KERNEL_VERSION=$(uname -r 2>/dev/null || echo "")
        _btime_sec=$(awk '$1=="btime"{print $2}' /proc/stat 2>/dev/null || echo "")
        if [ -n "${_btime_sec}" ]; then
            BOOT_TIME=$(awk -v b="${_btime_sec}" 'BEGIN { printf "%.0f", (b + 0) * 1000 }')
        else
            uptime_sec=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
            now_sec=$(date +%s)
            BOOT_TIME=$(awk -v n="${now_sec}" -v u="${uptime_sec}" '
                BEGIN {
                    if (u + 0 > 0) {
                        s = (n + 0) - (u + 0)
                        if (s < 0) s = 0
                        printf "%.0f", s * 1000
                    } else {
                        printf "0"
                    }
                }
            ')
        fi
        CPU_INFO=$(awk '/model name|system type|Processor/ { val = substr($0, index($0, ":") + 1); gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", val); if (val != "") { print val; exit } }' /proc/cpuinfo 2>/dev/null || echo "")
        [ -z "${CPU_INFO}" ] && CPU_INFO=${ARCH}
        CPU_CORES=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1")
    fi

    if [ $((LOOP_START_TIME - LAST_STATUS_CHECK)) -ge "${STATUS_CHECK_INTERVAL}" ] || [ "${LAST_STATUS_CHECK}" -eq 0 ]; then
        LOAD_AVG=$(awk '{print $1, $2, $3}' /proc/loadavg 2>/dev/null || echo "0 0 0")
        [ -z "${LOAD_AVG}" ] && LOAD_AVG="0 0 0"
        PROCESSES=$( (ps -e 2>/dev/null || ps 2>/dev/null) | wc -l || echo 0 )
        PROCESSES=$(printf '%s' "${PROCESSES:-0}" | tr -d ' \t\r\n')

        TCP_CONN=""
        if command -v ss >/dev/null 2>&1; then
            TCP_CONN=$(ss -H -ant state established 2>/dev/null | wc -l)
        else
            TCP_CONN=$(awk 'NR>1 && $4=="01"{c++} END{print c+0}' /proc/net/tcp 2>/dev/null)
        fi
        TCP_CONN=$(printf "%s" "${TCP_CONN:-0}" | tr -d '\r\n ')

        UDP_CONN=""
        if command -v ss >/dev/null 2>&1; then
            UDP_CONN=$(ss -H -anu 2>/dev/null | wc -l)
        else
            UDP_CONN=$(awk 'NR>1{c++} END{print c+0}' /proc/net/udp 2>/dev/null)
        fi
        UDP_CONN=$(printf "%s" "${UDP_CONN:-0}" | tr -d '\r\n ')

        MONTHLY_TRAFFIC=$(calc_monthly_traffic "$RX_NOW" "$TX_NOW")
        RX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $1}')
        TX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $2}')

        LAST_STATUS_CHECK="${LOOP_START_TIME}"
    fi

    TIME_DELTA=$((LOOP_START_TIME - PREV_LOOP_TIME))
    [ "${TIME_DELTA}" -le 0 ] && TIME_DELTA=${ACTIVE_INTERVAL}

    _speed_calc=$(awk -v rn="${RX_NOW}" -v rp="${RX_PREV}" -v tn="${TX_NOW}" -v tp="${TX_PREV}" -v dt="${TIME_DELTA}" '
        BEGIN {
            d = (dt + 0 > 0) ? (dt + 0) : 1
            rd = (rn + 0) - (rp + 0); if (rd < 0) rd = 0
            td = (tn + 0) - (tp + 0); if (td < 0) td = 0
            printf "%.0f %.0f\n", int(rd / d), int(td / d)
        }
    ')
    RX_SPEED=$(printf '%s' "$_speed_calc" | awk '{print $1}')
    TX_SPEED=$(printf '%s' "$_speed_calc" | awk '{print $2}')

    RX_PREV=${RX_NOW}
    TX_PREV=${TX_NOW}
    PREV_LOOP_TIME=${LOOP_START_TIME}

    [ -f "${RUN_DIR}/ipv4" ] && IPV4=$(cat "${RUN_DIR}/ipv4" 2>/dev/null || echo "0") || IPV4="0"
    [ -f "${RUN_DIR}/ipv6" ] && IPV6=$(cat "${RUN_DIR}/ipv6" 2>/dev/null || echo "0") || IPV6="0"
    is_valid_ipv4 "$IPV4" || IPV4="0"
    is_valid_ipv6 "$IPV6" || IPV6="0"

    if [ -f "${RUN_DIR}/probe_ct" ]; then _p=$(cat "${RUN_DIR}/probe_ct" 2>/dev/null || echo ""); PING_CT=${_p%% *}; LOSS_CT=${_p##* }; else PING_CT=""; LOSS_CT=""; fi
    if [ -f "${RUN_DIR}/probe_cu" ]; then _p=$(cat "${RUN_DIR}/probe_cu" 2>/dev/null || echo ""); PING_CU=${_p%% *}; LOSS_CU=${_p##* }; else PING_CU=""; LOSS_CU=""; fi
    if [ -f "${RUN_DIR}/probe_cm" ]; then _p=$(cat "${RUN_DIR}/probe_cm" 2>/dev/null || echo ""); PING_CM=${_p%% *}; LOSS_CM=${_p##* }; else PING_CM=""; LOSS_CM=""; fi
    if [ -f "${RUN_DIR}/probe_bd" ]; then _p=$(cat "${RUN_DIR}/probe_bd" 2>/dev/null || echo ""); PING_BD=${_p%% *}; LOSS_BD=${_p##* }; else PING_BD=""; LOSS_BD=""; fi

    ESERVER_ID=$(escape_json "${SERVER_ID}")
    ESECRET=$(escape_json "${SECRET}")
    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")
    EKERNEL=$(escape_json "${KERNEL_VERSION}")
    ELOAD=$(escape_json "${LOAD_AVG}")
    EIPV4=$(escape_json "${IPV4}")
    EIPV6=$(escape_json "${IPV6}")
    PING_CT_JSON=$(json_probe_value "$CT_NODE" "$PING_CT")
    PING_CU_JSON=$(json_probe_value "$CU_NODE" "$PING_CU")
    PING_CM_JSON=$(json_probe_value "$CM_NODE" "$PING_CM")
    PING_BD_JSON=$(json_probe_value "$BD_NODE" "$PING_BD")
    LOSS_CT_JSON=$(json_probe_value "$CT_NODE" "$LOSS_CT")
    LOSS_CU_JSON=$(json_probe_value "$CU_NODE" "$LOSS_CU")
    LOSS_CM_JSON=$(json_probe_value "$CM_NODE" "$LOSS_CM")
    LOSS_BD_JSON=$(json_probe_value "$BD_NODE" "$LOSS_BD")

    METRICS_JSON=$(cat <<EOF
{"cpu":"$CPU","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load_avg":"$ELOAD","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_rx_monthly":"$RX_MONTHLY","net_tx_monthly":"$TX_MONTHLY","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","kernel_version":"$EKERNEL","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$EIPV4","ip_v6":"$EIPV6","ping_ct":$PING_CT_JSON,"ping_cu":$PING_CU_JSON,"ping_cm":$PING_CM_JSON,"ping_bd":$PING_BD_JSON,"loss_ct":$LOSS_CT_JSON,"loss_cu":$LOSS_CU_JSON,"loss_cm":$LOSS_CM_JSON,"loss_bd":$LOSS_BD_JSON}
EOF
)
    SAMPLE_METRICS_JSON=$(cat <<EOF
{"cpu":"$CPU","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED"}
EOF
)
    if [ "$COLLECT_INTERVAL" -gt 0 ]; then
        SAMPLE_TS=$(awk -v t="$LOOP_START_TIME" 'BEGIN { printf "%.0f", (t + 0) * 1000 }')
        SAMPLE_JSON="{\"ts\":$SAMPLE_TS,\"metrics\":$SAMPLE_METRICS_JSON}"
        if [ -z "$SAMPLES_JSON" ]; then
            SAMPLES_JSON="$SAMPLE_JSON"
        else
            SAMPLES_JSON="$SAMPLES_JSON,$SAMPLE_JSON"
        fi
        SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
    fi

    if [ "$LAST_REPORT_TIME" -eq 0 ] || [ $((LOOP_START_TIME - LAST_REPORT_TIME)) -ge "$REPORT_INTERVAL" ]; then
        if [ "$COLLECT_INTERVAL" -gt 0 ]; then
            PAYLOAD=$(cat <<EOF
{"id":"$ESERVER_ID","secret":"$ESECRET","metrics":$METRICS_JSON,"samples":[$SAMPLES_JSON],"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        else
            PAYLOAD=$(cat <<EOF
{"id":"$ESERVER_ID","secret":"$ESECRET","metrics":$METRICS_JSON,"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        fi
        REPORT_RESPONSE_FILE=$(umask 077; mktemp "${RUN_DIR}/response.XXXXXX" 2>/dev/null) || REPORT_RESPONSE_FILE=""
        REPORT_HEADER_FILE=$(umask 077; mktemp "${RUN_DIR}/headers.XXXXXX" 2>/dev/null) || REPORT_HEADER_FILE=""
        if [ -n "$REPORT_RESPONSE_FILE" ] && [ -n "$REPORT_HEADER_FILE" ]; then
            REPORT_HTTP_CODE=$(printf '%s' "$PAYLOAD" | curl -sS -D "$REPORT_HEADER_FILE" -o "$REPORT_RESPONSE_FILE" -w "%{http_code}" -X POST \
                -H "Content-Type: application/json" \
                -H "X-Agent-Config-Schema: 3" \
                -H "X-Agent-Version: ${AGENT_VERSION}" \
                -H "X-Agent-Config-Md5: ${CONFIG_MD5:-none}" \
                --data-binary @- -m 8 --connect-timeout 3 -- "$WORKER_URL" 2>/dev/null || echo 000)
            case "$REPORT_HTTP_CODE" in ''|*[!0-9]*) REPORT_HTTP_CODE=000 ;; esac
            if [ "$REPORT_HTTP_CODE" = "200" ]; then
                apply_remote_config "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" || true
            fi
        fi
        rm -f "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" 2>/dev/null || true
        SAMPLES_JSON=""
        SAMPLE_COUNT=0
        LAST_REPORT_TIME=$LOOP_START_TIME
    fi

    sleep "${ACTIVE_INTERVAL}"
done
PROBE_EOF

    chmod 755 "${_script_tmp}"
    mv -f "${_script_tmp}" "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

create_service() {
    exec_line="/bin/sh \"${SCRIPT_FILE}\""

    if [ "$INIT_SYSTEM" = "procd" ]; then
        step "构建 procd init 脚本..."
        cat > "${PROCD_FILE}" << EOF
#!/bin/sh /etc/rc.common

START=99
STOP=15
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /bin/sh "${SCRIPT_FILE}"
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param pidfile "${PID_FILE}"
    procd_close_instance
}

stop_service() {
    rm -f "${PID_FILE}"
}

service_triggers() {
    procd_add_reload_trigger "${SERVICE_NAME}"
}
EOF
        chmod +x "${PROCD_FILE}"
        info "procd 服务脚本生成: ${PROCD_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        step "构建 OpenRC init 脚本..."
        cat > "${PROCD_FILE}" << EOF
#!/sbin/openrc-run

description="CF Server Monitor Probe Agent"
command="/bin/sh"
command_args="${SCRIPT_FILE}"
command_background="yes"
pidfile="${PID_FILE}"
output_log="${LOG_FILE}"
error_log="${LOG_FILE}"

depend() {
    need net
    use dns
    after firewall
}
EOF
        chmod +x "${PROCD_FILE}"
        info "OpenRC 服务脚本生成: ${PROCD_FILE}"
    else
        step "非 procd/OpenRC 环境 — 将使用手动后台进程方式运行..."
        info "启停命令将写入: ${SCRIPT_FILE}.ctl"
    fi

    cat > "${SCRIPT_FILE}.ctl" << EOF
#!/bin/sh
export LC_ALL=C LANG=C
PID_FILE='${PID_FILE}'
LOG_FILE='${LOG_FILE}'

case "\${1:-start}" in
    start)
        if command -v pgrep >/dev/null 2>&1 && pgrep -f '${SCRIPT_FILE}' >/dev/null 2>&1; then
            echo '探针已在运行。'
            exit 0
        fi
        nohup /bin/sh '${SCRIPT_FILE}' >> "\$LOG_FILE" 2>&1 &
        echo \$! > "\$PID_FILE"
        echo "探针已启动（PID: \$(cat "\$PID_FILE")）"
        ;;
    stop)
        if command -v pkill >/dev/null 2>&1; then
            pkill -9 -f '${SCRIPT_FILE}' >/dev/null 2>&1 || true
        elif [ -f "\$PID_FILE" ]; then
            PID=\$(cat "\$PID_FILE")
            kill -TERM "\$PID" >/dev/null 2>&1 || true
            sleep 1
            kill -9 "\$PID" >/dev/null 2>&1 || true
        fi
        rm -f "\$PID_FILE"
        echo '探针已停止。'
        ;;
    status)
        if command -v pgrep >/dev/null 2>&1 && pgrep -f '${SCRIPT_FILE}' >/dev/null 2>&1; then
            echo '运行中'
        elif [ -f "\$PID_FILE" ] && kill -0 "\$(cat "\$PID_FILE")" >/dev/null 2>&1; then
            echo "运行中（PID: \$(cat "\$PID_FILE")）"
        else
            echo '未运行'
        fi
        ;;
    restart)
        "\$0" stop
        sleep 1
        "\$0" start
        ;;
    log)
        tail -f "\$LOG_FILE"
        ;;
    *)
        echo "用法: \$0 {start|stop|status|restart|log}"
        exit 1
        ;;
esac
EOF
    chmod +x "${SCRIPT_FILE}.ctl"
}

start_service() {
    step "加载进程树并激活监控探针..."

    if [ "$INIT_SYSTEM" = "procd" ]; then
        "$PROCD_FILE" enable >/dev/null 2>&1 || true
        "$PROCD_FILE" restart || error "procd 服务启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        rc-update add "${SERVICE_NAME}" default >/dev/null 2>&1 || true
        rc-service "${SERVICE_NAME}" restart || error "OpenRC 服务启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    else
        sh "${SCRIPT_FILE}.ctl" start || error "后台进程启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    fi

    sleep 2

    service_running=0
    if command -v pgrep >/dev/null 2>&1 && pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "procd" ] && command -v ubus >/dev/null 2>&1 && ubus call service list 2>/dev/null | grep -q "\"${SERVICE_NAME}\""; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "procd" ] && [ -f "$PROCD_FILE" ] && "$PROCD_FILE" status >/dev/null 2>&1; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "openrc" ] && rc-service "${SERVICE_NAME}" status >/dev/null 2>&1; then
        service_running=1
    elif [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        service_running=1
    fi

    if [ "$service_running" -eq 1 ]; then
        info "探针监控引擎已进入平稳运行状态。"
    else
        warn "探针服务可能未启动成功。请排查: tail -n 30 ${LOG_FILE}"
    fi
}

install_probe() {
    SERVER_ID=""
    SECRET="${CF_PROBE_SECRET:-}"
    unset CF_PROBE_SECRET || true
    WORKER_URL=""
    COLLECT_INTERVAL=""
    REPORT_INTERVAL=""
    CT_NODE=""
    CU_NODE=""
    CM_NODE=""
    BD_NODE=""
    INTERFACE=""
    RESET_DAY=""
    AUTO_UPDATE=""
    RX_CORRECTION=""
    TX_CORRECTION=""

    for arg in "$@"; do
        case "$arg" in
            -id=*) SERVER_ID="${arg#-id=}" ;;
            -secret=*) SECRET="${arg#-secret=}" ;;
            -url=*) WORKER_URL="${arg#-url=}" ;;
            -collect_interval=*|-collect=*) COLLECT_INTERVAL="${arg#*=}" ;;
            -interval=*) REPORT_INTERVAL="${arg#-interval=}" ;;
            -ct=*) CT_NODE="${arg#-ct=}" ;;
            -cu=*) CU_NODE="${arg#-cu=}" ;;
            -cm=*) CM_NODE="${arg#-cm=}" ;;
            -bd=*) BD_NODE="${arg#-bd=}" ;;
            -interface=*|-interfaces=*|-iface=*) INTERFACE="${arg#*=}" ;;
            -reset_day=*) RESET_DAY="${arg#-reset_day=}" ;;
            -auto_update=*|-auto-update=*) AUTO_UPDATE=$(normalize_binary_value "${arg#*=}") || error "auto_update 参数非法，仅支持 0 或 1" ;;
            -rx_correction=*)
                RX_CORRECTION="${arg#-rx_correction=}"
                is_valid_correction_value "$RX_CORRECTION" || error "rx_correction 参数非法，必须为 0 到 ${MAX_TRAFFIC_CORRECTION_GB} 之间的非负数字"
                ;;
            -tx_correction=*)
                TX_CORRECTION="${arg#-tx_correction=}"
                is_valid_correction_value "$TX_CORRECTION" || error "tx_correction 参数非法，必须为 0 到 ${MAX_TRAFFIC_CORRECTION_GB} 之间的非负数字"
                ;;
        esac
    done

    print_banner
    check_root
    detect_os
    install_deps
    stop_old_service

    if [ -f "${CONFIG_FILE}" ]; then
        step "检测到已有配置文件，执行二次安装..."
        ensure_secure_config_dir

        if [ -n "${SERVER_ID}" ] && [ -n "${SECRET}" ] && [ -n "${WORKER_URL}" ]; then
            validate_worker_url "${WORKER_URL}" || error "url 参数非法，必须以 https:// 或 http:// 开头且不含空白或引号"
            COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
            REPORT_INTERVAL=${REPORT_INTERVAL:-60}
            [ -z "$RESET_DAY" ] && RESET_DAY=1
            normalize_probe_config
            AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

            step "更新配置文件..."
            INTERFACE=$(normalize_interface_list "${INTERFACE:-}") || error "interface parameter is invalid; use comma-separated interface names"
            atomic_write_file "${CONFIG_FILE}" << EOF
SERVER_ID="${SERVER_ID}"
SECRET="${SECRET}"
WORKER_URL="${WORKER_URL}"
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
INTERFACE="${INTERFACE:-}"
RESET_DAY="${RESET_DAY}"
AUTO_UPDATE="${AUTO_UPDATE}"
CONFIG_MD5="none"
EOF
            info "配置文件已更新: ${CONFIG_FILE}"
        else
            step "从配置文件读取参数..."
            chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
            while IFS='=' read -r key value; do
                case "$key" in
                    SERVER_ID) SERVER_ID="${value%\"}"; SERVER_ID="${SERVER_ID#\"}" ;;
                    SECRET) SECRET="${value%\"}"; SECRET="${SECRET#\"}" ;;
                    WORKER_URL) WORKER_URL="${value%\"}"; WORKER_URL="${WORKER_URL#\"}" ;;
                    COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
                    REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
                    CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
                    CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
                    CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
                    BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
                    INTERFACE) INTERFACE="${value%\"}"; INTERFACE="${INTERFACE#\"}" ;;
                    RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
                    AUTO_UPDATE) AUTO_UPDATE="${value%\"}"; AUTO_UPDATE="${AUTO_UPDATE#\"}" ;;
                esac
            done < "${CONFIG_FILE}"
            validate_worker_url "${WORKER_URL}" || error "配置文件中的 WORKER_URL 非法"
        fi
    else
        if [ -z "${SERVER_ID}" ] || [ -z "${SECRET}" ] || [ -z "${WORKER_URL}" ]; then
            print_usage
        fi
        validate_worker_url "${WORKER_URL}" || error "url 参数非法，必须以 https:// 或 http:// 开头且不含空白或引号"

        COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
        REPORT_INTERVAL=${REPORT_INTERVAL:-60}
        [ -z "$RESET_DAY" ] && RESET_DAY=1
        normalize_probe_config
        AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

        step "创建受保护配置目录..."
        ensure_secure_config_dir

        if [ -f "${OLD_TRAFFIC_DATA_FILE}" ]; then
            step "迁移旧流量数据..."
            mv "${OLD_TRAFFIC_DATA_FILE}" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
            chmod 600 "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
            rm -rf /var/lib/cf-probe 2>/dev/null || true
            info "已从旧路径迁移流量数据"
        elif [ ! -f "${TRAFFIC_DATA_FILE}" ]; then
            (umask 077; : > "${TRAFFIC_DATA_FILE}") 2>/dev/null || true
            info "创建新流量数据文件"
        fi

        step "生成配置文件..."
        INTERFACE=$(normalize_interface_list "${INTERFACE:-}") || error "interface parameter is invalid; use comma-separated interface names"
        atomic_write_file "${CONFIG_FILE}" << EOF
SERVER_ID="${SERVER_ID}"
SECRET="${SECRET}"
WORKER_URL="${WORKER_URL}"
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
INTERFACE="${INTERFACE:-}"
RESET_DAY="${RESET_DAY}"
AUTO_UPDATE="${AUTO_UPDATE}"
CONFIG_MD5="none"
EOF
        info "配置文件已生成: ${CONFIG_FILE}"
    fi

    COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
    REPORT_INTERVAL=${REPORT_INTERVAL:-60}
    normalize_probe_config
    AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"
    INTERFACE=$(normalize_interface_list "${INTERFACE:-}") || error "interface parameter is invalid; use comma-separated interface names"

    if [ -n "${RX_CORRECTION}" ] || [ -n "${TX_CORRECTION}" ]; then
        step "应用流量校正..."
        rm -f "${OLD_TRAFFIC_DATA_FILE}" 2>/dev/null || true
        ensure_secure_config_dir
        now_ts=$(date '+%s')
        rx_correction_bytes=0
        tx_correction_bytes=0
        current_net=$(get_configured_net_bytes "${INTERFACE:-}")
        current_rx=$(echo "${current_net}" | awk '{print $1}'); current_rx=${current_rx:-0}
        current_tx=$(echo "${current_net}" | awk '{print $2}'); current_tx=${current_tx:-0}
        [ -n "${RX_CORRECTION}" ] && rx_correction_bytes=$(echo "${RX_CORRECTION}" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
        [ -n "${TX_CORRECTION}" ] && tx_correction_bytes=$(echo "${TX_CORRECTION}" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
        [ -n "${RX_CORRECTION}" ] && info "下行流量校正: ${RX_CORRECTION}GB"
        [ -n "${TX_CORRECTION}" ] && info "上行流量校正: ${TX_CORRECTION}GB"

        atomic_write_file "${TRAFFIC_DATA_FILE}" << EOF
RX_PREV=${current_rx}
TX_PREV=${current_tx}
RX_PERIOD=${rx_correction_bytes}
TX_PERIOD=${tx_correction_bytes}
LAST_CHECK=${now_ts}
PERIOD_START=0
INTERFACE=${INTERFACE:-}
EOF
    fi

    create_script
    create_service
    start_service

    printf '\n%b=============================================%b\n' "${GREEN}" "${NC}"
    printf  '         CF-Server-Monitor %s 安装成功\n' "${AGENT_VERSION}"
    printf  '%b=============================================%b\n' "${GREEN}" "${NC}"
    printf  '  服务状态 : %bActive (Running)%b\n' "${GREEN}" "${NC}"
    printf  '  配置参数 :\n'
    printf  '    ● Server ID   : %s\n' "${SERVER_ID}"
    printf  '    ● Secret      : %s\n' "********"
    printf  '    ● Worker URL  : %s\n' "${WORKER_URL}"
    printf  '    ● 上报间隔    : %s秒\n' "${REPORT_INTERVAL}"
    printf  '    ● 采样间隔    : %s秒\n' "${COLLECT_INTERVAL}"
    printf  '    ● 自动更新    : %s\n' "${AUTO_UPDATE}"
    [ -n "${RX_CORRECTION}" ] && printf  '    ● 下行校正    : %sGB\n' "${RX_CORRECTION}"
    [ -n "${TX_CORRECTION}" ] && printf  '    ● 上行校正    : %sGB\n' "${TX_CORRECTION}"
    printf  '    Interface   : %s\n' "${INTERFACE:-auto}"
    if [ "${RESET_DAY}" = "0" ]; then
        printf  '    ● 流量重置日  : 不重置\n'
    else
        printf  '    ● 流量重置日  : %s号\n' "${RESET_DAY}"
    fi
    [ -n "${CT_NODE}" ] && printf  '    ● CT节点      : %s\n' "${CT_NODE}"
    [ -n "${CU_NODE}" ] && printf  '    ● CU节点      : %s\n' "${CU_NODE}"
    [ -n "${CM_NODE}" ] && printf  '    ● CM节点      : %s\n' "${CM_NODE}"
    [ -n "${BD_NODE}" ] && printf  '    ● BD节点      : %s\n' "${BD_NODE}"
    printf  '  运行模式 : '
    case "$INIT_SYSTEM" in
        procd) echo "procd 系统服务 (${PROCD_FILE})" ;;
        openrc) echo "OpenRC 系统服务 (${PROCD_FILE})" ;;
        *)     if [ -f "$PID_FILE" ]; then echo "手动后台进程 (PID: $(cat "$PID_FILE"))"; else echo "手动后台进程"; fi ;;
    esac
    printf  '  管理指令 :\n'
    if [ "$INIT_SYSTEM" = "procd" ]; then
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 查看状态     : %s status\n' "${PROCD_FILE}"
        printf  '    ● 启动/停止    : %s {start|stop|restart}\n' "${PROCD_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 查看状态     : rc-service %s status\n' "${SERVICE_NAME}"
        printf  '    ● 启动/停止    : rc-service %s {start|stop|restart}\n' "${SERVICE_NAME}"
    else
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 启动/停止    : sh %s {start|stop|restart|status|log}\n' "${SCRIPT_FILE}.ctl"
    fi
    printf  '    ● 彻底卸载     : sh %s uninstall\n' "$0"
    printf  '%b=============================================%b\n\n' "${GREEN}" "${NC}"
}

uninstall_probe() {
    print_banner
    printf '%b[!] 开始执行无残留深度卸载清理方案...%b\n\n' "${YELLOW}" "${NC}"
    check_root
    detect_os

    step "取消延迟自动更新任务..."
    kill_matching_processes ".auto_update."
    kill_matching_processes "cf-probe-auto-update"
    kill_matching_processes "auto_update_install"

    step "停用并撤销系统守护进程..."
    stop_old_service

    step "清理服务脚本文件..."
    rm -f "${PROCD_FILE}"

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}" "${SCRIPT_FILE}.ctl"

    step "抹除运行目录与缓存区..."
    rm -rf /run/cf-probe /var/run/cf-probe 2>/dev/null || true
    rm -f /tmp/.cf_ipv4 /tmp/.cf_ipv6 /tmp/.cf_probe_* 2>/dev/null || true

    step "抹除流量追踪数据..."
    rm -rf /var/lib/${SERVICE_NAME}
    rm -rf "${CONFIG_DIR}"

    step "清理日志与 PID 文件..."
    rm -f "${PID_FILE}" "${LOG_FILE}" 2>/dev/null || true

    printf '\n%b╔══════════════════════════════════════════╗%b\n' "${GREEN}" "${NC}"
    printf  '║     ✓ 卸载完毕！系统环境无任何残留。     ║\n'
    printf  '%b╚══════════════════════════════════════════╝%b\n\n' "${GREEN}" "${NC}"
}

case "${1:-install}" in
    install)
        shift 1 2>/dev/null || true
        install_probe "$@"
        ;;
    uninstall|remove|delete|purge)
        uninstall_probe
        ;;
    *)
        echo "未知指令. 可选命令: install | uninstall"
        exit 1
        ;;
esac
