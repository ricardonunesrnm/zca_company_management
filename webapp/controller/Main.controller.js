sap.ui.define([
    "zcacompanymanagement/controller/BaseController", "zcacompanymanagement/model/formatter","zcacompanymanagement/variants/VariantUtil",
], (BaseController, formatter, VariantUtil) => {
    "use strict";

    return BaseController.extend("zcacompanymanagement.controller.Main", {
        formatter: formatter,
        onInit() {
            this._variantUtil = new VariantUtil();
            this._variantUtil.handleAttachToController(this, {
                variantSetPath: "/ZCA_USR_VARIANTS_DD",
                smartFilterBarId: "smartFilterBar",
                smartTableId: "smartTable"
            });
        },
 
        onBeforeRendering: function () {
            this.handleStartVariants();
        },

        onShowVariantList: function (oEvent) {
            return this._variantUtil.onShowVariantList.call(this, oEvent);
        },

        onVariantManagePress: function (oEvent) {
            return this._variantUtil.onVariantManagePress.call(this, oEvent);
        },

        onVariantSaveAsPress: function (oEvent) {
            return this._variantUtil.onVariantSaveAsPress.call(this, oEvent);
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