package com.o2native

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.openobserve.android.rum.GlobalRumMonitor
import com.openobserve.android.rum.RumActionType
import com.openobserve.android.rum.RumErrorSource

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = "O2 Native Android — service=o2-native-android"
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 48)
        })

        fun button(label: String, onClick: () -> Unit) {
            root.addView(Button(this).apply {
                text = label
                setOnClickListener { onClick() }
            })
        }

        val rum = GlobalRumMonitor.get()

        button("Trigger handled error") {
            rum.addError(
                "O2 Native — handled error from Main",
                RumErrorSource.SOURCE,
                RuntimeException("handled test error"),
                emptyMap(),
            )
        }
        button("Custom action") {
            rum.addAction(RumActionType.CUSTOM, "Native custom action", emptyMap())
        }
        button("Go to Details") {
            startActivity(Intent(this, DetailsActivity::class.java))
        }
        button("Trigger native crash") {
            throw RuntimeException("O2 Native — intentional uncaught crash")
        }

        setContentView(root)
    }
}
