sap.ui.define([
  "zcacompanymanagement/controller/BaseController",
  "sap/ui/model/json/JSONModel"
], (BaseController, JSONModel) => {
  "use strict";

  return BaseController.extend("zcacompanymanagement.controller.App", {
      onInit: function () {
        var oViewModel = new JSONModel({
          busy: false,
          delay: 0,
        });

        this.setModel(oViewModel, "appView");

        var urlParams = new URLSearchParams(window.location.search);
        var token = urlParams.get("token");
        this.setModelCA(token);
        if (!sessionStorage.getItem("oLangu"))
          sap.ui.getCore().getConfiguration().setLanguage("EN");
        else {
          sap.ui
            .getCore()
            .getConfiguration()
            .setLanguage(sessionStorage.getItem("oLangu"));
        }

        var fnSetAppNotBusy = function () {
          oViewModel.setProperty("/busy", false);
          oViewModel.setProperty("/delay", 0);
        };
      },
  });
});