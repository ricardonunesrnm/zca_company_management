sap.ui.define([
    "zcacompanymanagement/controller/BaseController", "zcacompanymanagement/model/formatter"
], (BaseController, formatter) => {
    "use strict";

    return BaseController.extend("zcacompanymanagement.controller.Main", {
        formatter: formatter,
        onInit() {
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (!oItem) return;

            var oCtx = oItem.getBindingContext();
            if (!oCtx) return;

            var oRow = oCtx.getObject() || {};
            var sPartner = oRow.partner;
            if (!sPartner) return;

            sessionStorage.setItem("goToLaunchpad", "");
            this.getRouter().navTo("CompanyDisplay", { partner: sPartner }, false);
        },
    });
});