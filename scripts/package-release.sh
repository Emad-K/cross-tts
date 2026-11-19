#!/usr/bin/env bash
# Package the installers for the current CI runner, signing them when the
# release workflow was given signing secrets and building unsigned otherwise.
# Called from the Package step of .github/workflows/release.yml, which maps the
# secrets to the MAC_* / WIN_* variables read here. See docs/SIGNING.md.
set -euo pipefail

args=(--publish never)
signing="none (unsigned build)"

case "${RUNNER_OS:-}" in
macOS)
	if [ -n "${MAC_CSC_LINK:-}" ]; then
		signing="Apple Developer ID"
		export CSC_LINK="$MAC_CSC_LINK"
		export CSC_KEY_PASSWORD="${MAC_CSC_KEY_PASSWORD:-}"
		# electron-builder notarizes by itself once it sees either set of
		# credentials, and fails the build if a set is incomplete.
		if [ -n "${MAC_APPLE_API_KEY_P8:-}" ]; then
			signing+=", notarized with an App Store Connect API key"
			key_file="${RUNNER_TEMP:?}/apple-api-key.p8"
			(umask 077 && printf '%s\n' "$MAC_APPLE_API_KEY_P8" >"$key_file")
			export APPLE_API_KEY="$key_file"
			export APPLE_API_KEY_ID="${MAC_APPLE_API_KEY_ID:-}"
			export APPLE_API_ISSUER="${MAC_APPLE_API_ISSUER:-}"
		elif [ -n "${MAC_APPLE_ID:-}" ]; then
			signing+=", notarized with an Apple ID"
			export APPLE_ID="$MAC_APPLE_ID"
			export APPLE_APP_SPECIFIC_PASSWORD="${MAC_APPLE_APP_SPECIFIC_PASSWORD:-}"
			export APPLE_TEAM_ID="${MAC_APPLE_TEAM_ID:-}"
		else
			echo "::warning::Signing without notarization secrets: macOS will still warn when the app is opened."
		fi
	fi
	;;
Windows)
	if [ -n "${WIN_AZURE_CLIENT_ID:-}" ]; then
		signing="Azure Artifact Signing"
		export AZURE_TENANT_ID="${WIN_AZURE_TENANT_ID:?AZURE_TENANT_ID secret is missing}"
		export AZURE_CLIENT_ID="$WIN_AZURE_CLIENT_ID"
		export AZURE_CLIENT_SECRET="${WIN_AZURE_CLIENT_SECRET:?AZURE_CLIENT_SECRET secret is missing}"
		args+=(
			"-c.win.azureSignOptions.endpoint=${WIN_AZURE_ENDPOINT:?AZURE_SIGNING_ENDPOINT secret is missing}"
			"-c.win.azureSignOptions.codeSigningAccountName=${WIN_AZURE_ACCOUNT:?AZURE_SIGNING_ACCOUNT secret is missing}"
			"-c.win.azureSignOptions.certificateProfileName=${WIN_AZURE_PROFILE:?AZURE_SIGNING_PROFILE secret is missing}"
			"-c.win.azureSignOptions.publisherName=${WIN_AZURE_PUBLISHER:?AZURE_SIGNING_PUBLISHER secret is missing}"
		)
	elif [ -n "${WIN_PFX_LINK:-}" ]; then
		signing="certificate file (.pfx)"
		export WIN_CSC_LINK="$WIN_PFX_LINK"
		export WIN_CSC_KEY_PASSWORD="${WIN_PFX_PASSWORD:-}"
	fi
	;;
esac

if [ "$signing" = "none (unsigned build)" ]; then
	# Don't let electron-builder pick up a certificate the runner happens to have.
	export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

echo "Code signing: $signing"
exec pnpm exec electron-builder "${args[@]}"
