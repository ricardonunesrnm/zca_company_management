sap.ui.define(
  [
    "sap/ui/core/UIComponent",
    "sap/ui/core/IconPool",
    "zcacompanymanagement/model/models",
  ],
  (UIComponent, IconPool, models) => {
    "use strict";

    return UIComponent.extend("zcacompanymanagement.Component", {
      metadata: {
        manifest: "json",
        interfaces: ["sap.ui.core.IAsyncContentCreation"],
      },

      init() {
        // Register BusinessSuiteInAppSymbols
        IconPool.registerFont({
          fontFamily: "BusinessSuiteInAppSymbols",
          fontURI: sap.ui.require.toUrl("sap/ushell/themes/base/fonts/"),
        });

        // call the base component's init function
        UIComponent.prototype.init.apply(this, arguments);

        // set the device model
        this.setModel(models.createDeviceModel(), "device");

        // enable routing
        this.getRouter().initialize();
      },
    });
  },
);
