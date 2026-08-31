package com.o2native

import android.app.Application
import com.openobserve.android.OpenObserve
import com.openobserve.android._InternalProxy
import com.openobserve.android.core.configuration.BatchProcessingLevel
import com.openobserve.android.core.configuration.BatchSize
import com.openobserve.android.core.configuration.Configuration
import com.openobserve.android.core.configuration.UploadFrequency
import com.openobserve.android.log.Logs
import com.openobserve.android.log.LogsConfiguration
import com.openobserve.android.privacy.TrackingConsent
import com.openobserve.android.rum.Rum
import com.openobserve.android.rum.RumConfiguration
import com.openobserve.android.rum.tracking.ActivityViewTrackingStrategy
import com.openobserve.android.sessionreplay.ImagePrivacy
import com.openobserve.android.sessionreplay.SessionReplay
import com.openobserve.android.sessionreplay.SessionReplayConfiguration
import com.openobserve.android.sessionreplay.TextAndInputPrivacy
import com.openobserve.android.sessionreplay.TouchPrivacy

// RUM target comes from BuildConfig (build.gradle.kts injects env-overridable values; defaults are
// the dev cluster). Lets CI retarget the app at a local instance without editing source.
private val ORG = BuildConfig.OO_ORG
private val BASE = "${BuildConfig.OO_HOST}/rum/v1/$ORG"

class SampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val configuration = Configuration.Builder(
            clientToken = BuildConfig.OO_TOKEN,
            env = BuildConfig.OO_ENV,
            service = "o2-native-android",
        ).apply {
            // Developer mode (this is a debug build) uploads telemetry IMMEDIATELY instead of via
            // WorkManager — which otherwise stalls for minutes on an emulator, so a short E2E
            // session's data never lands. It also relaxes cleartext for local/dev endpoints.
            setUseDeveloperModeWhenDebuggable(true)
            setUploadFrequency(UploadFrequency.FREQUENT)
            setBatchSize(BatchSize.SMALL)
            setBatchProcessingLevel(BatchProcessingLevel.HIGH)
            // The SDK's OkHttp client rejects cleartext by default ("CLEARTEXT communication not
            // enabled"). The native core does NOT interpret the _o2.needsClearTextHttp additionalConfig
            // key (only the RN wrapper does), so call the internal helper directly — same as the RN
            // wrapper. An http:// endpoint (self-contained CI OpenObserve) needs this or it gets ZERO
            // uploads; https:// (introspect) does not and stays strict.
            if (BuildConfig.OO_HOST.startsWith("http://")) {
                _InternalProxy.allowClearTextHttp(this)
            }
        }.build()
        OpenObserve.initialize(this, configuration, TrackingConsent.GRANTED)

        Rum.enable(
            RumConfiguration.Builder(applicationId = "o2-native-android")
                .useCustomEndpoint("$BASE/rum")
                .trackUserInteractions()
                .trackLongTasks()
                .useViewTrackingStrategy(ActivityViewTrackingStrategy(trackExtras = true))
                .build(),
        )

        Logs.enable(
            LogsConfiguration.Builder()
                .useCustomEndpoint("$BASE/logs")
                .build(),
        )

        SessionReplay.enable(
            SessionReplayConfiguration.Builder(sampleRate = 100f)
                .useCustomEndpoint("$BASE/replay")
                .setTextAndInputPrivacy(TextAndInputPrivacy.MASK_ALL)
                .setImagePrivacy(ImagePrivacy.MASK_ALL)
                .setTouchPrivacy(TouchPrivacy.SHOW)
                .build(),
        )

        // Attach a user identity (mirrors the RN app).
        OpenObserve.setUserInfo(
            id = "native-001",
            name = "Alex Morgan",
            email = "alex.morgan@example.com",
            extraInfo = emptyMap(),
        )
    }
}
