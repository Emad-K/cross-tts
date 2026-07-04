#!/bin/bash
# Custom deb postinstall. Providing deb.afterInstall REPLACES electron-builder's
# default template (app-builder-lib/templates/linux/after-install.tpl), so this
# reproduces that template's work — the /usr/bin launcher symlink, the
# chrome-sandbox handling, and the mime/desktop database refresh — and then adds
# an AppArmor profile.
#
# Why the profile: Ubuntu 24.04+ ships kernel.apparmor_restrict_unprivileged_userns=1,
# which blocks the unprivileged user namespaces Electron's sandbox relies on
# unless the binary is covered by an AppArmor profile that grants `userns`.
# Without it the app aborts at launch ("SUID sandbox helper ... is not configured
# correctly", or the zygote dies with "Invalid argument"). Chrome, Chromium and
# VS Code ship the same kind of profile. Our install path also contains a space
# ("/opt/Cross TTS"), which breaks the SUID-sandbox fallback, so the userns path
# this profile enables is the reliable one on modern Ubuntu.
#
# electron-builder macro-expands ${executable} and ${sanitizedProductName} in
# this file at build time (see FpmTarget.createScripts); do NOT introduce any
# other dollar-brace tokens — an unknown macro makes the build throw.

# --- /usr/bin launcher symlink (default template) ---
if type update-alternatives 2>/dev/null >&1; then
    # Remove a previous link that doesn't use update-alternatives.
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# --- chrome-sandbox SUID fallback (default template) ---
# Only needed on kernels without working user namespaces; where the AppArmor
# profile below enables userns, Electron uses that path and ignores the SUID bit.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

# --- AppArmor profile granting user namespaces (Ubuntu 24.04+) ---
if [ -d /etc/apparmor.d ] && command -v apparmor_parser >/dev/null 2>&1; then
    # No `abi` pin: the parser picks its own default so the profile loads on
    # 22.04 (abi 3.0) through 24.04+ (abi 4.0/5.0) alike. flags=(unconfined)
    # keeps behaviour identical to no profile, except that `userns` is granted.
    cat > '/etc/apparmor.d/${executable}' <<'APPARMOR_PROFILE'
include <tunables/global>

profile ${executable} "/opt/${sanitizedProductName}/${executable}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides.
  include if exists <local/${executable}>
}
APPARMOR_PROFILE
    apparmor_parser -r -T -W '/etc/apparmor.d/${executable}' 2>/dev/null || true
fi

# --- mime / desktop databases (default template) ---
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
