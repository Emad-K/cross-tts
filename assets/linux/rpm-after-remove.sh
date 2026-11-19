#!/bin/bash
# Custom rpm %postun (rpm.afterRemove). Same job as deb-after-remove.sh, but
# rpm runs the OLD package's %postun AFTER the NEW package's %post on upgrade,
# so cleaning up then would delete the launcher link and AppArmor profile the
# new version just installed. rpm passes the number of installs left in $1:
# 0 = real removal, 1+ = upgrade. Only clean up on removal.
#
# The AppArmor part is a no-op on SELinux distros (Fedora, RHEL): there is no
# profile file to remove. ${executable} is macro-expanded by electron-builder
# at build time; do not add other dollar-brace tokens.

if [ "$1" != "0" ]; then
    exit 0
fi

# --- Remove the /usr/bin launcher (default template) ---
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

# --- Remove and unload the AppArmor profile ---
if [ -f '/etc/apparmor.d/${executable}' ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -R '/etc/apparmor.d/${executable}' 2>/dev/null || true
    fi
    rm -f '/etc/apparmor.d/${executable}'
fi
