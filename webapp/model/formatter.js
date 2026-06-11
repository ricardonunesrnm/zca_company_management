sap.ui.define(["sap/ui/core/format/DateFormat"], function (DateFormat) {
  "use strict";

  var formatter = {
    dateFormatter: function (v) {
      if (!v) return "";

      var oDate = v instanceof Date ? v : new Date(v);
      if (isNaN(oDate.getTime())) return "";

      return DateFormat.getDateInstance({ pattern: "dd/MM/yyyy" }).format(oDate);
    },

    getDocState: function (value) {
      if (value === "0003") return "Error"; //Declined
      if (value === "0002") return "Success"; //Approved
      if (value === "0001") return "Information"; //In Approval
      if (value === "0006") return "Error"; //Expired Documentation
      return "None";
    },

    getApprovalState: function (value) {
      if (value === "E0001") return "Information"; //In Approval
      if (value === "E0002") return "Success"; //Approved
      if (value === "E0003") return "Error"; //Declined
      if (value === "E0004") return "Warning"; //Documentation Missing
      if (value === "E0005") return "Error"; //Expired Documentation
      return "None";
    },

    getApprovalIcon: function (value) {
      if (value === "E0001") return "sap-icon://pending"; // In Approval
      if (value === "E0002") return "sap-icon://accept"; // Approved
      if (value === "E0003") return "sap-icon://decline"; // Declined
      if (value === "E0004") return "sap-icon://warning2"; // Documentation Missing
      if (value === "E0005") return "sap-icon://lateness"; // Expired Documentation
      return "";
    },

    // getConditionalText: function (isActive, companyStatusTxt) {
    //   if (formatter._isActive(isActive)) {
    //     return companyStatusTxt;
    //   }

    //   return this.getView().getModel("i18n").getResourceBundle().getText("partnerDeactivated");
    // },

    // _isActive: function (value) {
    //   return value === "A" || value === true;
    // },

    getConditionalState: function (isActive, companyStatus) {
      // if (!formatter._isActive(isActive)) {
      //   return "None";
      // }
      return formatter.getApprovalState(companyStatus);
    },

    getConditionalIcon: function (isActive, companyStatus) {
      // if (!formatter._isActive(isActive)) {
      //   return "sap-icon://locked";
      // }
      return formatter.getApprovalIcon(companyStatus);
    },

    // getActiveHighlight: function (value) {
    //   return formatter._isActive(value) ? "None" : "Error";
    // }
  };

  return formatter;
});