package com.o2native

import android.app.Application
import com.openobserve.android.OpenObserve
import com.openobserve.android.core.configuration.Configuration
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

// reactnativeapp org on the migrated cluster (same org as the RN app).
private const val ORG = "3HOStgiihM8H43cMLWY3BUfXV5r"
private const val BASE = "https://dev.common-dev.internal.zinclabs.dev/rum/v1/$ORG"

class SampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val configuration = Configuration.Builder(
            clientToken = "rumtbJXyJcgC8jB9Otu",
            env = "testing",
            service = "o2-native-android",
        ).build()
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
