#!/bin/bash
# Custom deb postremove. Providing deb.afterRemove REPLACES electron-builder's
# default template (after-remove.tpl), so this reproduces the /usr/bin launcher
# removal and additionally removes the AppArmor profile that deb-after-install.sh
# installed.
#
# On upgrade, dpkg runs the OLD package's postrm before the NEW package's
# postinst, so the profile is removed here and immediately reinstalled by the new
# deb-after-install.sh — no gap in coverage after the upgrade completes.
#
# ${executable} is macro-expanded by electron-builder at build time; do not add
# other dollar-brace tokens.

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
