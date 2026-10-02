# Xiaoya TV Android app

Original standalone Android TV client for the local Xiaoya relay.

Features:

- Traditional Chinese interface and grouped categories supplied by Xiaoyakankan;
- paged poster catalogue and title search;
- title details and episode selection;
- local favourites, editable history, and resume positions;
- Media3 HLS playback with left/right 15-second seeking;
- configurable relay address (default `http://10.0.0.105:8787`).

Build with Android SDK 35 and JDK 17+:

```powershell
$env:ANDROID_HOME = 'C:\xiaoya-android-tools\sdk'
gradle assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
