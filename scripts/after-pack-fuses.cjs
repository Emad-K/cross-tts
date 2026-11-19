// electron-builder afterPack hook: flip Electron fuses on the packaged binary
// (electron-builder 25 has no `electronFuses` option; 26+ does). Runs before
// code signing. See the comment above `afterPack` in electron-builder.yml.
const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

exports.default = async function afterPack(context) {
	const { electronPlatformName, appOutDir, packager, arch } = context;
	const name = packager.appInfo.productFilename;
	const exe =
		electronPlatformName === "darwin"
			? path.join(appOutDir, `${name}.app`)
			: electronPlatformName === "win32"
				? path.join(appOutDir, `${name}.exe`)
				: path.join(appOutDir, packager.executableName);
	await flipFuses(exe, {
		version: FuseVersion.V1,
		// Flipping fuses invalidates the arm64 ad-hoc signature; re-sign it.
		resetAdHocDarwinSignature: electronPlatformName === "darwin" && arch === 3, // Arch.arm64
		[FuseV1Options.RunAsNode]: false,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
	});
};
