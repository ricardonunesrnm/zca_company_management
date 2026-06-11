sap.ui.define([ "zcacompanymanagement/controller/BaseController","sap/ui/core/Fragment","sap/ui/model/json/JSONModel","sap/m/MessageBox","sap/m/MessageToast","sap/ui/model/Filter","sap/ui/model/FilterOperator","zcacompanymanagement/model/formatter"
], function ( BaseController, Fragment, JSONModel, MessageBox, MessageToast, Filter, FilterOperator, formatter) {
  "use strict";

  return BaseController.extend("zcacompanymanagement.controller.Create", {
    formatter: formatter,

    onInit: function () {
      this._sCurrentPartner = null;
      this._pDocDlg = null;
      this._oDocDlg = null;
      this._pCompanyDocTypes = null;

      this.setShellBackButton(function () {
        sessionStorage.setItem("goToLaunchpad", "X");
        this.getRouter().navTo("RouteMain", {}, true); 
      }.bind(this));

      this.setModel(new JSONModel(this._getEmptyCompanyData()), "CompanyData");
      this.setModel(new JSONModel(this._getEmptyUiState()), "UiState");
      this.setModel(new JSONModel({ items: [] }), "CompanyDocumentsData");
      this.setModel(new JSONModel(this._getEmptyDocumentDialogData()), "DocumentDialogData");
      this.setModel(new JSONModel(this._getEmptyValueHelpData()), "ValueHelpData");

      this.getRouter().getRoute("CompanyEdit").attachPatternMatched(this.onEditMatched, this);

      sessionStorage.setItem("goToLaunchpad", "");
    },

    onAfterRendering: function () {
      sessionStorage.setItem("goToLaunchpad", "");
    },

    onExit: function () {
      this.setShellBackButton();
    },

    _getEmptyCompanyData: function () {
      return { Mode: "edit", PageTitle: "", Partner: "", NameOrg1: "", CompanyStatus: "", CompanyStatusCode: "", CompanyStatusText: "", Phone: "", Email: "", Fax: "", Street: "", HouseNumber: "", PostalCode: "", City: "", Country: "", CountryText: "" };
    },

    _getEmptyUiState: function () {
      return { companyDocSelectedIndex: -1, companyDocListEnabled: false, companyDocAddEnabled: false, companyDocEditEnabled: false, companyDocDelEnabled: false };
    },

    _getEmptyDocumentDialogData: function () {
      return { Mode: "add", Index: -1, DocType: "", DocName: "", ArcDocId: "", ValidTo: null, ValidToText: "", FileName: "", FileB64: "", FileChanged: false, ManualReadConfirmed: false };
    },

    _getEmptyValueHelpData: function () {
      return { DocTypes: [{ key: "", text: "" }] };
    },

    onEditMatched: function (oEvent) {
      var sPartner = oEvent.getParameter("arguments").partner;

      if (!sPartner) {
        sessionStorage.setItem("goToLaunchpad", "X");
        this.getRouter().navTo("RouteMain", {}, true);
        return;
      }

      sessionStorage.setItem("goToLaunchpad", "");

      this.onResetPage();
      this._sCurrentPartner = sPartner;

      this.setViewBusy(true);

      this.loadEditData(sPartner)
        .then(function () {
          this.onRefreshUiState();
        }.bind(this))
        .catch(function (oError) {
          this.showODataError(
            oError,
            this.getResourceBundle().getText("msgLoadCompanyError")
          );

          sessionStorage.setItem("goToLaunchpad", "");
          this.getRouter().navTo("CompanyDisplay", { partner: sPartner }, true);
        }.bind(this))
        .finally(function () {
          this.setViewBusy(false);
        }.bind(this));
    },

    onResetPage: function () {
      var oList;

      this._pCompanyDocTypes = null;

      this.getModel("CompanyData").setData(this._getEmptyCompanyData());
      this.getModel("UiState").setData(this._getEmptyUiState());
      this.getModel("CompanyDocumentsData").setData({ items: [] });
      this.getModel("DocumentDialogData").setData(this._getEmptyDocumentDialogData());
      this.getModel("ValueHelpData").setData(this._getEmptyValueHelpData());

      oList = this.byId("lstCompanyDocumentsChange");
      if (oList && oList.removeSelections) {
        oList.removeSelections(true);
      }
    },

    loadEditData: function (sPartner) {
      return Promise.all([
        this.loadCompany(sPartner),
        this.loadCompanyDocuments(sPartner),
        this.loadCompanyDocTypes()
      ]).then(function (aResults) {
        var aDocs = aResults[1] || [];
        var aDocTypes = aResults[2] || [];

        this.getModel("CompanyDocumentsData").setProperty("/items", aDocs);
        this.getModel("ValueHelpData").setProperty("/DocTypes", aDocTypes);
        this.getModel("UiState").setProperty("/companyDocSelectedIndex", -1);
      }.bind(this));
    },

    loadCompany: function (sPartner) {
      return this.readOEntity(
        "/" + this.getODataModel().createKey("ZCA_COMPANY", {
          partner: sPartner
        }),
        {
          urlParameters: {
            $select: ["partner", "name_org1", "company_status", "company_status_code", "company_status_txt", "fax", "phone", "email", "street", "house_number", "postal_code", "city", "country", "country_txt"].join(",")
          }
        }
      ).then(function (oData) {
        var sPartnerId = oData.partner || "";
        var sName = oData.name_org1 || "";

        this.getModel("CompanyData").setData({
          Mode: "edit",
          Partner: sPartnerId,
          NameOrg1: sName,
          CompanyStatus: oData.company_status || "",
          CompanyStatusCode: oData.company_status_code || "",
          CompanyStatusText: oData.company_status_txt || "",
          Phone: oData.phone || "",
          Email: oData.email || "",
          Fax: oData.fax || "",
          Street: oData.street || "",
          HouseNumber: oData.house_number || "",
          PostalCode: oData.postal_code || "",
          City: oData.city || "",
          Country: oData.country || "",
          CountryText: oData.country_txt || "",
          PageTitle: sName ? sName : sPartnerId
        });
      }.bind(this));
    },

    loadCompanyDocuments: function (sPartner) {
      if (!sPartner) {
        return Promise.resolve([]);
      }

      return this.readOEntity("/ZCA_COMPANY_DOCS", {
        filters: [new Filter("partner", FilterOperator.EQ, sPartner)],
        urlParameters: {
          $select: "partner,doc_type,doc_type_txt,arc_doc_id,archiv_id,ar_date,document_type,valid_to,filename,doc_status,doc_status_txt,document_name,mandatory",
          $orderby: "doc_type"
        }
      }).then(function (oData) {
        var aDocs = oData && oData.results ? oData.results : [];
        var oRB = this.getResourceBundle();

        var aMapped = aDocs.map(function (r) {
          var sDocType = String(r.doc_type || "").toUpperCase();
          var bMandatory = r.mandatory === true;
          var sMandatoryText = bMandatory ? oRB.getText("mandatory") : oRB.getText("optional");


          return {
            Partner: r.partner || "",
            DocType: r.doc_type || "",
            ArcDocId: r.arc_doc_id || "",
            ArchivId: r.archiv_id || "",
            ArDate: r.ar_date || null,
            DocumentType: r.document_type || "",
            DocumentName: r.document_name || "",
            FileName: r.filename || "",
            DocTitle: sDocType === "ZPM_COTHER" ? (r.document_name || r.doc_type_txt || "") : (r.doc_type_txt || ""),
            ValidTo: r.valid_to || null,
            Status: r.doc_status || "",
            StatusText: r.doc_status_txt || r.doc_status || "",
            StatusState: formatter.getDocState ? formatter.getDocState(r.doc_status) : "None",
            Mandatory: bMandatory,
            MandatoryText: sMandatoryText
          };
        });

        aMapped.sort(function (a, b) {
          if (a.Mandatory !== b.Mandatory) {
            return a.Mandatory ? -1 : 1;
          }

          return String(a.DocTitle || "").localeCompare(String(b.DocTitle || ""));
        });

        return aMapped;
      }.bind(this));
    },

    loadCompanyDocTypes: function () {
      if (this._pCompanyDocTypes) {
        return this._pCompanyDocTypes;
      }

      this._pCompanyDocTypes = this.readOEntity("/ZCA_COMPANY_DOC_RULE_VH", {
        urlParameters: {
          $select: "doctype,doctype_txt,mandatory",
          $orderby: "doctype_txt"
        }
      }).then(function (oData) {
        var a = oData && oData.results ? oData.results : [];

        var aItems = a.map(function (r) {
          return {
            key: r.doctype || "",
            text: r.doctype_txt || r.doctype || "",
            mandatory: r.mandatory === true
          };
        });

        aItems.sort(function (a, b) {
          if (a.mandatory !== b.mandatory) {
            return a.mandatory ? -1 : 1;
          }

          return String(a.text || "").localeCompare(String(b.text || ""));
        });

        aItems.unshift({ key: "", text: "", mandatory: false });

        return aItems;
      });

      return this._pCompanyDocTypes;
    },

    onRefreshUiState: function () {
      var oUi = this.getModel("UiState");
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner") || "";
      var iCompanyDoc = oUi.getProperty("/companyDocSelectedIndex");
      var bEnabled = !!sPartner;

      oUi.setProperty("/companyDocListEnabled", bEnabled);
      oUi.setProperty("/companyDocAddEnabled", bEnabled);
      oUi.setProperty("/companyDocEditEnabled", bEnabled && iCompanyDoc >= 0);
      oUi.setProperty("/companyDocDelEnabled", bEnabled && iCompanyDoc >= 0);
    },

    onCompanyDocSelectionChange: function (oEvent) {
      var oList = oEvent.getSource();
      var oItem = oEvent.getParameter("listItem");
      var i = -1;

      if (oItem) {
        i = oList.indexOfItem(oItem);
      }

      this.getModel("UiState").setProperty("/companyDocSelectedIndex", i);
      this.onRefreshUiState();
    },

    onDownloadSupplierManual: function(){
      var sUrl = sap.ui.require.toUrl("zcacompanymanagement/img/RNM_Safety_and_Environmental_Regulations.pdf");
      var oLink = document.createElement("a");
      oLink.href = sUrl;
      oLink.download = "RNM_Safety_and_Environmental_Regulations.pdf";
      document.body.appendChild(oLink);
      oLink.click();
      document.body.removeChild(oLink);
    },

    getDocDlg: function () {
      if (this._pDocDlg) {
        return this._pDocDlg;
      }

      this._pDocDlg = Fragment.load({
        id: this.getView().getId(),
        name: "zcacompanymanagement.view.fragments.DocumentDialog",
        controller: this
      }).then(function (oDlg) {
        this.getView().addDependent(oDlg);
        this._oDocDlg = oDlg;
        return oDlg;
      }.bind(this));

      return this._pDocDlg;
    },

    _resetDocumentDialogControls: function () {
      var oHiddenDP = this.byId("HiddenDP");
      var oInp = this.byId("inpValidTo");
      var oUploader = this.byId("fuDocument");

      if (oHiddenDP) {
        oHiddenDP.setDateValue(null);
        oHiddenDP.setValue("");
        oHiddenDP.setValueState("None");
        oHiddenDP.setValueStateText("");
      }

      if (oInp) {
        oInp.setValue("");
        oInp.setValueState("None");
        oInp.setValueStateText("");
      }

      if (oUploader && oUploader.clear) {
        try {
          oUploader.clear();
        } catch (e) {}
      }
    },

    onCompanyDocAdd: function () {
      var oUi = this.getModel("UiState");
      var oDocDlg = this.getModel("DocumentDialogData");
      var aDocs = this.getModel("CompanyDocumentsData").getProperty("/items") || [];
      var oRB = this.getResourceBundle();

      if (!oUi.getProperty("/companyDocAddEnabled")) {
        return;
      }

      this.loadCompanyDocTypes()
        .then(function (aItems) {
          var aFiltered = (aItems || []).filter(function (item) {
            var sKey = String(item.key || "").toUpperCase();

            if (!sKey) return true;
            if (sKey === "ZPM_COTHER") return true;

            return !aDocs.some(function (doc) {
              return String(doc.DocType || "").toUpperCase() === sKey;
            });
          });

          var bHasAddableDocType = aFiltered.some(function (item) {
            return !!item.key;
          });

          if (!bHasAddableDocType) {
            MessageBox.information(oRB.getText("msgAllCompanyDocsAlreadyAdded"));
            return;
          }

          oDocDlg.setData(this._getEmptyDocumentDialogData());
          this.getModel("ValueHelpData").setProperty("/DocTypes", aFiltered);

          return this.getDocDlg().then(function (oDlg) {
            this._resetDocumentDialogControls();
            oDlg.open();
          }.bind(this));
        }.bind(this))
        .catch(function () {
          MessageBox.error(oRB.getText("msgErrorLoadDocTypes"));
        });
    },

    onCompanyDocEdit: function () {
      var oUi = this.getModel("UiState");
      var aDocs = this.getModel("CompanyDocumentsData").getProperty("/items") || [];
      var i = oUi.getProperty("/companyDocSelectedIndex");
      var oDocDlg = this.getModel("DocumentDialogData");
      var r;
      var oValidTo;
      var oToday;
      var bExpired = false;
      var dd;
      var mm;
      var yyyy;
      var sValidToText = "";
      var oData;
      var oHiddenDP;
      var oInp;

      if (!oUi.getProperty("/companyDocEditEnabled")) {
        return;
      }

      if (i < 0 || !aDocs[i]) {
        return;
      }

      r = aDocs[i];
      oValidTo = r.ValidTo ? new Date(r.ValidTo) : null;

      oToday = new Date();
      oToday = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate(), 0, 0, 0, 0);

      if (oValidTo instanceof Date && !isNaN(oValidTo.getTime())) {
        oValidTo = new Date(oValidTo.getFullYear(), oValidTo.getMonth(), oValidTo.getDate(), 0, 0, 0, 0);
        bExpired = oValidTo < oToday;
        dd = String(oValidTo.getDate()).padStart(2, "0");
        mm = String(oValidTo.getMonth() + 1).padStart(2, "0");
        yyyy = String(oValidTo.getFullYear());
        sValidToText = dd + "/" + mm + "/" + yyyy;
      }

      oData = this._getEmptyDocumentDialogData();
      oData.Mode = "edit";
      oData.Index = i;
      oData.DocType = r.DocType;
      oData.DocName = r.DocumentName || "";
      oData.ArcDocId = r.ArcDocId;
      oData.ValidTo = oValidTo;
      oData.ValidToText = sValidToText;
      oData.FileName = r.FileName || "";

      oDocDlg.setData(oData);

      oHiddenDP = this.byId("HiddenDP");
      if (oHiddenDP) {
        oHiddenDP.setMinDate(oToday);
        oHiddenDP.setDateValue(bExpired ? null : oValidTo);
        oHiddenDP.setValueState("None");
        oHiddenDP.setValueStateText("");
      }

      oInp = this.byId("inpValidTo");
      if (oInp) {
        oInp.setValueState("None");
        oInp.setValueStateText("");
      }

      this.loadCompanyDocTypes()
        .then(function (aItems) {
          var bExists = aItems.some(function (item) {
            return item.key === r.DocType;
          });

          if (!bExists && r.DocType) {
            aItems = aItems.slice();
            aItems.push({
              key: r.DocType,
              text: r.DocTitle || r.DocType,
              mandatory: ""
            });
          }

          this.getModel("ValueHelpData").setProperty("/DocTypes", aItems);
        }.bind(this))
        .finally(function () {
          this.getDocDlg().then(function (oDlg) {
            oDlg.open();
          });
        }.bind(this));
    },

    onCompanyDocDelete: function () {
      var oUi = this.getModel("UiState");
      var aDocs = this.getModel("CompanyDocumentsData").getProperty("/items") || [];
      var i = oUi.getProperty("/companyDocSelectedIndex");
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner") || "";
      var r;
      var sPath;

      if (!oUi.getProperty("/companyDocDelEnabled")) {
        return;
      }

      if (i < 0 || !aDocs[i] || !sPartner) {
        return;
      }

      r = aDocs[i];

      sPath = "/" + this.getODataModel().createKey("ZCA_COMPANY_DOCS", {
        partner: r.Partner,
        doc_type: r.DocType,
        arc_doc_id: r.ArcDocId
      });

      MessageBox.confirm(this.getResourceBundle().getText("msgDelDoc"), {
        actions: [MessageBox.Action.YES, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.YES,
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.YES) {
            return;
          }

          this.setViewBusy(true);

          this.deleteOEntity(sPath)
            .then(function () {
              return this.loadCompanyDocuments(sPartner);
            }.bind(this))
            .then(function (aNewDocs) {
              var oList = this.byId("lstCompanyDocumentsChange");

              this.getModel("CompanyDocumentsData").setProperty("/items", aNewDocs);
              this.getModel("UiState").setProperty("/companyDocSelectedIndex", -1);

              if (oList && oList.removeSelections) {
                oList.removeSelections(true);
              }

              this.onRefreshUiState();
              MessageToast.show(this.getResourceBundle().getText("msgDocDeleted"));
            }.bind(this))
            .catch(function (oError) {
              this.showODataError(
                oError,
                this.getResourceBundle().getText("msgErrorDelDoc")
              );
            }.bind(this))
            .finally(function () {
              this.setViewBusy(false);
            }.bind(this));
        }.bind(this)
      });
    },

    onDocumentDialogDocTypeChange: function (oEvent) {
      var sDocType = String(oEvent.getSource().getSelectedKey() || "").toUpperCase();
      var oDocDlg = this.getModel("DocumentDialogData");

      oDocDlg.setProperty("/DocType", sDocType);
      oDocDlg.setProperty("/ManualReadConfirmed", false);
    },

    onOpenDocDatePicker: function (oEvent) {
      var oHiddenDP = this.byId("HiddenDP");
      var oToday = new Date();

      if (!oHiddenDP) return;

      oToday = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate(), 0, 0, 0, 0);

      oHiddenDP.setMinDate(oToday);
      oHiddenDP.openBy(oEvent.getSource().getDomRef());
    },

    onHiddenDocDateChange: function (oEvent) {
      var oRB = this.getResourceBundle();
      var oDate = oEvent.getSource().getDateValue();
      var oInp = this.byId("inpValidTo");
      var oDocDlg = this.getModel("DocumentDialogData");
      var oToday;
      var dd;
      var mm;
      var yyyy;

      if (!oDate || isNaN(oDate.getTime())) {
        oDocDlg.setProperty("/ValidTo", null);
        oDocDlg.setProperty("/ValidToText", "");

        if (oInp) {
          oInp.setValueState("Error");
          oInp.setValueStateText(oRB.getText("msgDocInvalidValidTo"));
        }

        MessageBox.error(oRB.getText("msgDocInvalidValidTo"));
        return;
      }

      oToday = new Date();
      oToday = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate(), 0, 0, 0, 0);
      oDate = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate(), 0, 0, 0, 0);

      if (oDate < oToday) {
        oDocDlg.setProperty("/ValidTo", null);
        oDocDlg.setProperty("/ValidToText", "");

        if (oInp) {
          oInp.setValueState("Error");
          oInp.setValueStateText(oRB.getText("msgDocInvalidValidTo"));
        }

        MessageBox.error(oRB.getText("msgDocInvalidValidTo"));
        return;
      }

      dd = String(oDate.getDate()).padStart(2, "0");
      mm = String(oDate.getMonth() + 1).padStart(2, "0");
      yyyy = String(oDate.getFullYear());

      oDocDlg.setProperty("/ValidTo", oDate);
      oDocDlg.setProperty("/ValidToText", dd + "/" + mm + "/" + yyyy);

      if (oInp) {
        oInp.setValueState("None");
        oInp.setValueStateText("");
      }
    },

    onDocFileChange: function (oEvent) {
      var aFiles = oEvent.getParameter("files");
      var oFileUploader = oEvent.getSource();
      var oDocDlg = this.getModel("DocumentDialogData");
      var oFile;
      var sName;
      var oReader;

      if (!aFiles || !aFiles.length) return;

      oFile = aFiles[0];
      sName = oFile && oFile.name ? oFile.name : "";

      oDocDlg.setProperty("/FileName", sName);
      oDocDlg.setProperty("/FileB64", "");
      oDocDlg.setProperty("/FileChanged", true);

      oReader = new FileReader();

      oReader.onload = function (e) {
        var sRes = e && e.target && e.target.result ? String(e.target.result) : "";
        var sB64 = sRes.indexOf(",") >= 0 ? sRes.split(",")[1] : sRes;

        oDocDlg.setProperty("/FileB64", sB64);
      };

      oReader.readAsDataURL(oFile);

      if (oFileUploader && oFileUploader.clear) {
        try {
          oFileUploader.clear();
        } catch (e) {}
      }
    },

    onDocDlgSave: function () {
      var d = this.getModel("DocumentDialogData").getData() || {};
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner") || "";
      var bEdit = d.Mode === "edit";
      var oRB = this.getResourceBundle();
      var oSel = this.byId("selDocType");
      var oInp = this.byId("inpValidTo");
      var aDocTypes = this.getModel("ValueHelpData").getProperty("/DocTypes") || [];
      var aDocs = this.getModel("CompanyDocumentsData").getProperty("/items") || [];
      var oValidTo = d.ValidTo;
      var oCheckDate;
      var oToday;
      var bValidDocType;
      var sDocType = String(d.DocType || "").toUpperCase();
      var bOtherDoc = sDocType === "ZPM_COTHER";
      var sDocName = String(d.DocName || "").trim();
      var bManualCompanyDoc = !bEdit && sDocType === "ZPM_MANUAL";
      var oPayload;
      var sPath;

      if (oSel) {
        oSel.setValueState("None");
        oSel.setValueStateText("");
      }

      if (oInp) {
        oInp.setValueState("None");
        oInp.setValueStateText("");
      }

      if (!sPartner) {
        MessageBox.error(oRB.getText("msgFillMandatoryFields"));
        return;
      }

      bValidDocType = !!d.DocType && aDocTypes.some(function (x) {
        return String(x.key || "").toUpperCase() === sDocType;
      });

      if (d.ValidTo) {
        oCheckDate = d.ValidTo instanceof Date ? d.ValidTo : new Date(d.ValidTo);

        if (oCheckDate instanceof Date && !isNaN(oCheckDate.getTime())) {
          oCheckDate = new Date(oCheckDate.getFullYear(), oCheckDate.getMonth(), oCheckDate.getDate(), 0, 0, 0, 0);
        } else {
          oCheckDate = null;
        }
      } else {
        oCheckDate = null;
      }

      oToday = new Date();
      oToday = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate(), 0, 0, 0, 0);

      if (!bEdit) {
        if (
          sDocType &&
          sDocType !== "ZPM_COTHER" && aDocs.some(function (x) {
            return String(x.DocType || "").toUpperCase() === sDocType;
          })
        ) {
          MessageBox.error(oRB.getText("msgDocTypeAlreadyExists"));
          return;
        }

        if (!bValidDocType) {
          if (oSel) {
            oSel.setValueState("Error");
            oSel.setValueStateText(oRB.getText("msgDocMissingType"));
          }

          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }

        if (!oCheckDate) {
          if (oInp) {
            oInp.setValueState("Error");
            oInp.setValueStateText(oRB.getText("msgDocMissingValidTo"));
          }

          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }

        if (oCheckDate < oToday) {
          if (oInp) {
            oInp.setValueState("Error");
            oInp.setValueStateText(oRB.getText("msgDocInvalidValidTo"));
          }

          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }

        if (!d.FileB64) {
          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }
      } else {
        if (!bValidDocType) {
          MessageBox.error(oRB.getText("msgDocMissingType"));
          return;
        }

        if (!oCheckDate) {
          if (oInp) {
            oInp.setValueState("Error");
            oInp.setValueStateText(oRB.getText("msgDocMissingValidTo"));
          }

          MessageBox.error(oRB.getText("msgDocMissingValidTo"));
          return;
        }

        if (oCheckDate < oToday) {
          if (oInp) {
            oInp.setValueState("Error");
            oInp.setValueStateText(oRB.getText("msgDocInvalidValidTo"));
          }

          MessageBox.error(oRB.getText("msgDocInvalidValidTo"));
          return;
        }

        if (d.FileChanged && !d.FileB64) {
          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }

        if (!d.ArcDocId) {
          MessageBox.error(oRB.getText("msgFillMandatoryFields"));
          return;
        }
      }

      oValidTo = new Date(oCheckDate.getFullYear(), oCheckDate.getMonth(), oCheckDate.getDate(), 12, 0, 0, 0);

      if (bOtherDoc && !sDocName) {
        MessageBox.error(oRB.getText("msgDocTitleMandatory"));
        return;
      }

      if (!bOtherDoc) {
        sDocName = "";
      }

      if (bManualCompanyDoc && d.ManualReadConfirmed !== true) {
        MessageBox.confirm(oRB.getText("msgConfirmManualRead"), {
          title: oRB.getText("confirmManualReadTitle"),
          actions: [MessageBox.Action.YES, MessageBox.Action.NO],
          emphasizedAction: MessageBox.Action.YES,
          onClose: function (sAction) {
            if (sAction !== MessageBox.Action.YES) {
              return;
            }

            this.getModel("DocumentDialogData").setProperty("/ManualReadConfirmed", true);
            this.onDocDlgSave();
          }.bind(this)
        });

        return;
      }

      this.setControlBusy(this._oDocDlg, true);

      if (!bEdit) {
        oPayload = {
          partner: sPartner,
          doc_type: d.DocType,
          document_name: sDocName,
          valid_to: oValidTo,
          attachment: d.FileB64
        };

        this.createOEntity("/ZCA_COMPANY_DOCS", oPayload)
          .then(function () {
            if (this._oDocDlg) {
              this._oDocDlg.close();
            }

            return this.loadCompanyDocuments(sPartner);
          }.bind(this))
          .then(function (aNewDocs) {
            this._afterDocumentsChanged(aNewDocs);
          }.bind(this))
          .catch(function (oError) {
            this.showODataError(oError, oRB.getText("msgErrorDocCreate"));
          }.bind(this))
          .finally(function () {
            this.setControlBusy(this._oDocDlg, false);
          }.bind(this));

        return;
      }

      sPath = "/" + this.getODataModel().createKey("ZCA_COMPANY_DOCS", {
        partner: sPartner,
        doc_type: d.DocType,
        arc_doc_id: d.ArcDocId
      });

      oPayload = {
        valid_to: oValidTo,
        document_name: sDocName,
        attachment: d.FileChanged === true ? d.FileB64 : ""
      };

      this.updateOEntity(sPath, oPayload, { merge: true })
        .then(function () {
          if (this._oDocDlg) {
            this._oDocDlg.close();
          }

          return this.loadCompanyDocuments(sPartner);
        }.bind(this))
        .then(function (aNewDocs) {
          this._afterDocumentsChanged(aNewDocs);
        }.bind(this))
        .catch(function (oError) {
          this.showODataError(oError, oRB.getText("msgErrorDocUpdate"));
        }.bind(this))
        .finally(function () {
          this.setControlBusy(this._oDocDlg, false);
        }.bind(this));
    },

    _afterDocumentsChanged: function (aNewDocs) {
      var oList = this.byId("lstCompanyDocumentsChange");

      this.getModel("CompanyDocumentsData").setProperty("/items", aNewDocs || []);
      this.getModel("UiState").setProperty("/companyDocSelectedIndex", -1);

      if (oList && oList.removeSelections) {
        oList.removeSelections(true);
      }

      this.onRefreshUiState();
    },

    onDocDlgCancel: function () {
      if (this._oDocDlg) {
        this._oDocDlg.close();
      }
    },

    onCancelPress: function () {
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner") || "";

      if (!sPartner) {
        sessionStorage.setItem("goToLaunchpad", "X");
        this.getRouter().navTo("RouteMain", {}, true);
        return;
      }

      sessionStorage.setItem("goToLaunchpad", "");
      this.getRouter().navTo("CompanyDisplay", { partner: sPartner }, true);
    }
  });
});