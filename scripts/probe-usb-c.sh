#!/bin/sh
# Run on the monitor over a TTY. Every Luna call and sysfs operation is a read.
printf '\nFirmware and kernel\n'
uname -r
for f in /etc/issue /etc/webos-release; do
    [ ! -r "$f" ] || head -n 3 "$f"
done

printf '\nwebOS inputs and foreground app\n'
luna-send -n 1 luna://com.webos.service.eim/getAllInputStatus '{}'
luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}'
printf '\nInput application directories\n'
ls /usr/palm/applications | grep -Ei 'usb.?c|displayport|externalinput' || :

printf '\nPicture and capability settings\n'
luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"picture","keys":["pictureMode","colorGamut"]}'
luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"picture","keys":["colorGamut"],"dimension":{"input":"usbc1","pictureMode":"expert1","_3dStatus":"2d"}}'
luna-send -n 1 luna://com.webos.service.config/getConfigs '{"configNames":["tv.model.*Vrr*","tv.model.*Ddc*","tv.model.*Usb*","tv.model.*FreeSync*","tv.model.*Gamut*"]}'

printf '\nUSB hub, receiver, Type-C and power inventory\n'
ls -l /sys/devices/platform/1805e000.usb_hub/ /sys/devices/platform/dprx/ \
    /sys/class/misc/rtk_dprx/ /sys/class/typec/ /sys/class/power_supply/ 2>/dev/null
for f in /sys/devices/platform/1805e000.usb_hub/switch_port \
    /sys/devices/platform/dprx/status /sys/devices/platform/dprx/dpcd \
    /sys/devices/platform/dprx/sdp /sys/devices/platform/dprx/debug_ctrl \
    /sys/class/typec/port*/power_role /sys/class/typec/port*/data_role \
    /sys/class/typec/port*/power_operation_mode \
    /sys/class/power_supply/*/type /sys/class/power_supply/*/voltage_now \
    /sys/class/power_supply/*/current_now /sys/class/power_supply/*/power_now; do
    if [ -r "$f" ]; then
        printf '\n%s\n' "$f"
        head -c 8192 "$f"
        printf '\n'
    fi
done

printf '\nUSB watcher state\n'
ls -l /var/lib/webosbrew/init.d/*usb* /var/lib/tvweb/usb-c.json 2>/dev/null
ps w | grep -E '[u]sb-hub-(webos|keep-monitor)' || :
