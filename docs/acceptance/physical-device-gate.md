# Physical-device acceptance gate

This gate closes only with an attached, trusted device. Source readiness and virtual-device acceptance do not substitute for the physical proof.

## iPhone — Mac Studio worker

1. Connect one iPhone by cable, unlock it, trust the Mac and enable Developer Mode.
2. Set `DFARMING_ENABLE_PHYSICAL_IOS=true` and configure `XCODE_ORG_ID`, `XCODE_SIGNING_ID` and `WDA_BUNDLE_ID` in the worker `.env`.
3. Run `./deploy/setup-device-worker.sh`, then confirm the iPhone appears under the physical **Devices** section of `xcrun xctrace list devices`.
4. Register the runtime from **dFarming → Add device**, keeping Appium/WDA as the control lane.
5. From the MiniPC production control plane run `npm run acceptance:live -- --udid <iphone-udid> --allow-input`. The receipt must prove screenshot, semantic snapshot, video bytes and the harmless Home action.
6. Run the physical-iOS WDA regression/video benchmark before changing any streaming default.

## Android — Linux worker

1. Connect one Android device by USB, enable Developer options and USB debugging, then accept the host RSA prompt.
2. Confirm `adb devices -l` reports a real serial in `device` state; `127.0.0.1:5555` and `emulator-*` do not count as physical proof.
3. Register the physical runtime from **dFarming → Add device** and confirm the MiniPC maps it to the Linux worker.
4. From the MiniPC production control plane run `npm run acceptance:live -- --udid <android-serial> --allow-input`.
5. The receipt must prove screenshot, UiAutomator2 semantic snapshot, video bytes and the harmless Home action.
6. Run the physical Android video benchmark with the default Appium stream and optional verified scrcpy transport; keep scrcpy optional unless measurements justify otherwise.

## Pass criteria

- Exactly one physical iPhone and one physical Android device are simultaneously visible to the MiniPC fleet.
- Both have `physical=connected` and `appium=ready`; the iPhone must also have the physical WDA/signing path ready.
- Both generate a persisted `dfarming-live-acceptance` receipt after the current release SHA is deployed.
- No simulator/emulator receipt may be used as evidence for a physical-device ticket.
