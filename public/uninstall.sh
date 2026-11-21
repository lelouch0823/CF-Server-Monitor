#!/bin/sh
# CF-Server-Monitor 通用卸载脚本
# 支持: systemd、OpenRC、OpenWrt procd、Synology DSM rc.d、macOS launchd

set -eu
export LC_ALL=C LANG=C

SERVICE_NAME="cf-probe"
ASSUME_YES=0

info() { printf '%s\n' "[+] $*"; }
warn() { printf '%s\n' "[!] $*" >&2; }
die() { printf '%s\n' "[x] $*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法: sudo sh uninstall.sh [选项]
  或: curl -fsSL https://example.com/uninstall.sh | sudo sh -s -- -y

选项:
  -y, --yes          不询问，直接卸载
  -h, --help         显示本帮助

默认会删除服务、探针脚本、延迟自动更新任务、配置、流量统计和日志。
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) usage; exit 0 ;;
        *) die "未知选项: $1（使用 --help 查看帮助）" ;;
    esac
    shift
done

[ "$(id -u)" -eq 0 ] || die "请以 root 权限运行，例如：sudo sh uninstall.sh"

if [ "$ASSUME_YES" -ne 1 ]; then
    if [ -t 0 ]; then
        printf '%s' "这会停止并删除 CF-Server-Monitor 探针及其数据。继续吗？[y/N] "
        read -r answer || answer=""
    elif ( : </dev/tty ) 2>/dev/null; then
        printf '%s' "这会停止并删除 CF-Server-Monitor 探针及其数据。继续吗？[y/N] " >/dev/tty 2>/dev/null || \
            printf '%s' "这会停止并删除 CF-Server-Monitor 探针及其数据。继续吗？[y/N] "
        read -r answer </dev/tty || answer=""
    else
        die "当前为非交互管道输入且无可用终端 (/dev/tty)。请传入 -s -- -y 确认卸载，例如：curl -fsSL <URL>/uninstall.sh | sudo sh -s -- -y"
    fi
    case "$answer" in
        y|Y|yes|YES) ;;
        *) info "已取消。"; exit 0 ;;
    esac
fi

kill_matching_processes() {
    _pat="$1"
    _self="$$"
    _ppid="${PPID:-0}"
    (ps -axo pid=,command= 2>/dev/null || ps -eo pid=,args= 2>/dev/null || ps -ww 2>/dev/null || ps 2>/dev/null) | \
        PAT="$_pat" awk -v sp="$_self" -v pp="$_ppid" '
            $1 ~ /^[0-9]+$/ && $1 != sp && $1 != pp && index($0, ENVIRON["PAT"]) > 0 { print $1 }
        ' | while IFS= read -r _pid; do
            [ -n "$_pid" ] && kill -9 "$_pid" 2>/dev/null || true
        done
}

cancel_auto_update_tasks() {
    if command -v systemctl >/dev/null 2>&1; then
        systemctl stop "${SERVICE_NAME}-auto-update-*" 2>/dev/null || true
        for _unit in $(systemctl list-units --all --no-legend 2>/dev/null | awk -v svc="${SERVICE_NAME}" '$1 ~ svc"-auto-update-" { print $1 }'); do
            systemctl stop "$_unit" 2>/dev/null || true
            systemctl reset-failed "$_unit" 2>/dev/null || true
        done
    fi
    # 清理 Alpine / macOS / OpenWrt / 群晖 / 容器后台延迟自动更新与安装子进程（排除当前 PID $$）
    kill_matching_processes ".auto_update."
    kill_matching_processes "cf-probe-auto-update"
    kill_matching_processes "auto_update_install"
    (ps -axo pid=,command= 2>/dev/null || ps -eo pid=,args= 2>/dev/null || ps -ww 2>/dev/null || ps 2>/dev/null) | \
        awk -v sp="$$" -v pp="${PPID:-0}" '
            $1 ~ /^[0-9]+$/ && $1 != sp && $1 != pp &&
            (($0 ~ /[s]leep/ && ($0 ~ /[a]uto_update/ || $0 ~ /[i]nstall(-alpine|-mac|-openwrt|-synology)?\.sh/ || $0 ~ /[b]ash -s install/)) ||
             ($0 ~ /[c]f-probe/ && $0 ~ /[a]uto_update/)) {
                print $1
            }
        ' | while IFS= read -r _pid; do
            [ -n "$_pid" ] && kill -9 "$_pid" 2>/dev/null || true
        done
}

stop_systemd() {
    if command -v systemctl >/dev/null 2>&1; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
}

stop_openrc() {
    if command -v rc-service >/dev/null 2>&1; then
        rc-service "$SERVICE_NAME" stop 2>/dev/null || true
    fi
    if command -v rc-update >/dev/null 2>&1; then
        rc-update del "$SERVICE_NAME" default 2>/dev/null || true
    fi
}

stop_procd() {
    if [ -x "/etc/init.d/${SERVICE_NAME}" ]; then
        "/etc/init.d/${SERVICE_NAME}" stop 2>/dev/null || true
        "/etc/init.d/${SERVICE_NAME}" disable 2>/dev/null || true
    fi
}

stop_launchd() {
    if command -v launchctl >/dev/null 2>&1; then
        launchctl bootout system /Library/LaunchDaemons/com.cf.probe.plist 2>/dev/null || \
            launchctl bootout system/com.cf.probe 2>/dev/null || true
    fi
}

stop_synology() {
    if [ -x "/usr/local/etc/rc.d/${SERVICE_NAME}.sh" ]; then
        "/usr/local/etc/rc.d/${SERVICE_NAME}.sh" stop 2>/dev/null || true
    fi
}

info "取消待执行的自动更新任务..."
cancel_auto_update_tasks

info "停止并取消注册服务..."
stop_systemd
stop_openrc
stop_procd
stop_launchd
stop_synology

info "删除服务定义和探针程序..."
rm -f \
    "/etc/systemd/system/${SERVICE_NAME}.service" \
    "/etc/init.d/${SERVICE_NAME}" \
    "/usr/local/etc/rc.d/${SERVICE_NAME}.sh" \
    "/Library/LaunchDaemons/com.cf.probe.plist" \
    "/usr/local/bin/${SERVICE_NAME}.sh" \
    "/usr/local/bin/${SERVICE_NAME}.sh.ctl"

if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload 2>/dev/null || true
    systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
fi

for pid_file in /run/cf-probe.pid /var/run/cf-probe.pid; do
    if [ -r "$pid_file" ]; then
        pid=$(cat "$pid_file" 2>/dev/null || true)
        case "$pid" in
            ''|*[!0-9]*) warn "忽略无效 PID 文件: $pid_file" ;;
            *) [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null || true ;;
        esac
    fi
    rm -f "$pid_file"
done

kill_matching_processes "/usr/local/bin/${SERVICE_NAME}.sh"

rm -f /run/cf-probe-debug.env /var/run/cf-probe-debug.env /var/log/cf-probe.log
rm -f /dev/shm/.cf_ipv4 /dev/shm/.cf_ipv6 /dev/shm/.cf_probe_*
rm -f /tmp/.cf_ipv4 /tmp/.cf_ipv6 /tmp/.cf_probe_*

info "删除配置、流量统计和运行目录..."
rm -rf \
    /run/cf-probe \
    /var/run/cf-probe \
    /etc/config/cf-probe \
    /usr/local/etc/cf-probe \
    "/Library/Application Support/cf-probe" \
    /var/lib/cf-probe \
    /tmp/cf-probe

info "CF-Server-Monitor 探针已卸载完成。"
