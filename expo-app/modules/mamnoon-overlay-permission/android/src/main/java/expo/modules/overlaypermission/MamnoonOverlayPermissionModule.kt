package expo.modules.overlaypermission

import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }
}
