package com.o2native

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.openobserve.android.okhttp.OpenObserveInterceptor
import com.openobserve.android.rum.GlobalRumMonitor
import com.openobserve.android.rum.RumActionType
import com.openobserve.android.rum.RumErrorSource
import java.io.IOException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class MainActivity : AppCompatActivity() {
    // OkHttp client instrumented with the OpenObserve interceptor → every request is tracked as a
    // RUM `resource`. The traced-hosts list only controls distributed-tracing headers; resources are
    // captured regardless.
    private val http = OkHttpClient.Builder()
        .addInterceptor(
            OpenObserveInterceptor.Builder(listOf("jsonplaceholder.typicode.com")).build(),
        )
        .build()

    private fun fetch(url: String) {
        http.newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

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
        button("Go to Checkout") {
            startActivity(Intent(this, CheckoutActivity::class.java))
        }
        button("Fetch resource 200") {
            fetch("https://jsonplaceholder.typicode.com/todos/1")
        }
        button("Fetch resource 404") {
            fetch("https://jsonplaceholder.typicode.com/this-path-does-not-exist-404")
        }
        button("Trigger native crash") {
            throw RuntimeException("O2 Native — intentional uncaught crash")
        }

        // Scrollable so every button stays reachable (Maestro scrolls to off-screen elements).
        setContentView(ScrollView(this).apply { addView(root) })
    }
}
