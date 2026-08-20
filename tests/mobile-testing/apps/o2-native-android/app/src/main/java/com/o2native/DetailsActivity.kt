package com.o2native

import android.os.Bundle
import android.view.Gravity
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

// A second screen — ActivityViewTrackingStrategy records it as a RUM view automatically.
class DetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "Details screen"
            textSize = 22f
            gravity = Gravity.CENTER
        })
    }
}
