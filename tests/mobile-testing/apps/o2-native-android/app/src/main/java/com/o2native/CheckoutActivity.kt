package com.o2native

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

// A checkout form carrying PII (email + card). Session Replay is configured MASK_ALL, so NONE of this
// text may appear in the recorded replay — the android-native masking test asserts exactly that.
class CheckoutActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = "Checkout (masking test)"
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 48)
        })
        root.addView(EditText(this).apply {
            setText("alex.morgan@example.com")
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        })
        root.addView(EditText(this).apply {
            setText("4242 4242 4242 4242")
            inputType = InputType.TYPE_CLASS_NUMBER
        })
        setContentView(root)
    }
}
