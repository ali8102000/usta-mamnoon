package expo.modules.overlaypermission

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MamnoonOverlayPermissionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MamnoonOverlayPermission")

    Function("isPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      Settings.canDrawOverlays(context)
    }

    Function("openAppSettings") {
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    Function("showRequestOverlay") { title: String, body: String, deepLink: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      if (!Settings.canDrawOverlays(context)) return@Function false
      Handler(Looper.getMainLooper()).post {
        showOverlay(context, title, body, deepLink)
        alert(context)
      }
      true
    }

    Function("hideRequestOverlay") {
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      Handler(Looper.getMainLooper()).post { removeOverlay(context) }
      true
    }
  }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()

  private fun showOverlay(context: Context, title: String, body: String, deepLink: String) {
    val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    removeOverlay(context)

    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      layoutDirection = View.LAYOUT_DIRECTION_RTL
      setPadding(dp(context, 18), dp(context, 16), dp(context, 18), dp(context, 14))
      background = GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = dp(context, 20).toFloat()
        setStroke(dp(context, 1), Color.rgb(220, 230, 243))
      }
      elevation = dp(context, 16).toFloat()
    }

    val heading = TextView(context).apply {
      text = title.ifBlank { "طلب جديد من ممنون" }
      textSize = 18f
      setTextColor(Color.rgb(17, 35, 59))
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.RIGHT
    }
    card.addView(heading, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    ))

    val description = TextView(context).apply {
      text = body
      textSize = 14f
      setTextColor(Color.rgb(65, 82, 105))
      gravity = Gravity.RIGHT
      setPadding(0, dp(context, 8), 0, dp(context, 12))
    }
    card.addView(description, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    ))

    val actions = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutDirection = View.LAYOUT_DIRECTION_RTL
      gravity = Gravity.CENTER
    }

    val accept = TextView(context).apply {
      text = "قبول الطلب"
      textSize = 15f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setPadding(dp(context, 18), dp(context, 12), dp(context, 18), dp(context, 12))
      background = GradientDrawable().apply {
        setColor(Color.rgb(0, 102, 255))
        cornerRadius = dp(context, 12).toFloat()
      }
      setOnClickListener {
        removeOverlay(context)
        try {
          context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        } catch (_: Exception) {
          val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
          launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
          if (launch != null) context.startActivity(launch)
        }
      }
    }
    actions.addView(accept, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

    val dismiss = TextView(context).apply {
      text = "إغلاق"
      textSize = 14f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(83, 98, 118))
      setPadding(dp(context, 16), dp(context, 12), dp(context, 16), dp(context, 12))
      setOnClickListener { removeOverlay(context) }
    }
    actions.addView(dismiss, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
    ))
    card.addView(actions)

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams(
      context.resources.displayMetrics.widthPixels - dp(context, 28),
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = dp(context, 24)
    }

    try {
      manager.addView(card, params)
      currentManager = manager
      currentView = card
    } catch (error: Exception) {
      android.util.Log.w("MamnoonOverlay", "Could not show request overlay", error)
    }
  }

  private fun removeOverlay(context: Context) {
    val view = currentView ?: return
    val manager = currentManager ?: (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
    try { manager.removeView(view) } catch (_: Exception) { }
    currentView = null
    currentManager = null
  }

  private fun alert(context: Context) {
    try {
      val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 320, 160, 320, 160, 420), -1))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(longArrayOf(0, 320, 160, 320, 160, 420), -1)
      }
    } catch (_: Exception) { }

    try {
      val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90)
      tone.startTone(ToneGenerator.TONE_PROP_BEEP, 500)
      Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 650)
    } catch (_: Exception) { }
  }

  companion object {
    @Volatile private var currentView: View? = null
    @Volatile private var currentManager: WindowManager? = null
  }
}
