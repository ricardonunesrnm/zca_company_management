sap.ui.define([ "zcacompanymanagement/controller/BaseController", "sap/ui/model/Sorter", "sap/ui/model/json/JSONModel", "sap/m/MessageBox", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "zcacompanymanagement/model/formatter", "sap/m/PDFViewer"
], function (BaseController, Sorter, JSONModel, MessageBox, Filter, FilterOperator, formatter, PDFViewer) {
  "use strict";

  return BaseController.extend("zcacompanymanagement.controller.Display", {
    formatter: formatter,

    onInit: function () {
      this._sCurrentPartner = null;
      this._oPdfViewer = null;
      this._sLastPdfUrl = null;

      this.setShellBackButton(function () {
        sessionStorage.setItem("goToLaunchpad", "X");
        this.getRouter().navTo("RouteMain", {}, true);
      }.bind(this));

      this.setModel(new JSONModel(this._getEmptyCompanyData()), "CompanyData");
      this.setModel(new JSONModel({ items: [] }), "CompanyDocumentsData");
      this.setModel(new JSONModel(this._getEmptyApprovalData()), "ApprovalData");

      sessionStorage.setItem("goToLaunchpad", "");

      this.getRouter().getRoute("CompanyDisplay").attachPatternMatched(this.onDisplayMatched, this);
    },

    onAfterRendering: function () {
      sessionStorage.setItem("goToLaunchpad", "");
    },

    onExit: function () {
      if (this._oPdfViewer) {
        this._oPdfViewer.destroy();
        this._oPdfViewer = null;
      }

      if (this._sLastPdfUrl) {
        try {
          URL.revokeObjectURL(this._sLastPdfUrl);
        } catch (e) {}

        this._sLastPdfUrl = null;
      }

      this.setShellBackButton();
    },

    _getEmptyCompanyData: function () {
      return { PageTitle: "", Partner: "", NameOrg1: "", CreatedBy: "", CreatedOn: null, ChangedBy: "", ChangedOn: null, CompanyStatus: "", CompanyStatusCode: "", CompanyStatusText: "", RejectReason: "", Phone: "", Email: "", Fax: "", Street: "", HouseNumber: "", PostalCode: "", City: "", Country: "", CountryText: "" };
    },

    _getEmptyApprovalData: function () {
      return { Action: "", Title: "", Message: "", ConfirmText: "", SelectedReasonKey: "", SelectedGrReason: "", SelectedGrReasonText: "", SelectedIdReason: "", SelectedReasonText: "", ArObject: "", ArObjectText: "", FreeText: "", IsDoc: false, IsOther: false, SavedReasons: [], HasSavedReasons: false };
    },

    onDisplayMatched: function (oEvent) {
      var sPartner = oEvent.getParameter("arguments").partner;

      // this.setShellBackButton(function () {
      //   sessionStorage.setItem("goToLaunchpad", "X");
      //   this.getRouter().navTo("RouteMain", {}, true);
      // }.bind(this));

      if (!sPartner) {
        sessionStorage.setItem("goToLaunchpad", "X");
        this.getRouter().navTo("RouteMain", {}, true);
        return;
      }

      sessionStorage.setItem("goToLaunchpad", "");

      this._sCurrentPartner = sPartner;
      this._resetDisplayModels();

      this.setViewBusy(true);

      this.loadDisplayData(sPartner)
        .catch(function (oError) {
          this.getModel("CompanyData").setData(this._getEmptyCompanyData());
          this.getModel("CompanyDocumentsData").setProperty("/items", []);

          this.showODataError(
            oError,
            this.getResourceBundle().getText("msgLoadCompanyError")
          );

          sessionStorage.setItem("goToLaunchpad", "X");
          this.getRouter().navTo("RouteMain", {}, true);
        }.bind(this))
        .finally(function () {
          this.setViewBusy(false);
        }.bind(this));
    },

    _resetDisplayModels: function () {
      this.getModel("CompanyData").setData(this._getEmptyCompanyData());
      this.getModel("CompanyDocumentsData").setData({ items: [] });
    },

    loadDisplayData: function (sPartner) {
      return Promise.all([
        this.loadCompany(sPartner),
        this.loadCompanyDocuments(sPartner)
      ]).then(function (aResults) {
        var aDocs = aResults[1] || [];

        this.getModel("CompanyDocumentsData").setProperty("/items", aDocs);

        if (this.getModel("CompanyData").getProperty("/CompanyStatus") !== "E0003") {
          this.getModel("CompanyData").setProperty("/RejectReason", "");
          return null;
        }

        return this.loadRejectReason(sPartner);
      }.bind(this)).then(function (sReason) {
        if (sReason === null) {
          return;
        }

        this.getModel("CompanyData").setProperty("/RejectReason", sReason || "");
      }.bind(this));
    },

    loadCompany: function (sPartner) {
      return this.readOEntity( "/" + this.getODataModel().createKey("ZCA_COMPANY", {
          partner: sPartner
        }),
        {
          urlParameters: {
            $select: [ "partner", "name_org1", "crusr", "crdat", "chusr", "chdat", "company_status", "company_status_code", "company_status_txt", "fax", "phone", "email", "street", "house_number", "postal_code", "city", "country", "country_txt" ].join(",")
          }
        }
      ).then(function (oData) {
        var sPartnerId = oData.partner || "";
        var sName = oData.name_org1 || "";

        this.getModel("CompanyData").setData({
          Partner: sPartnerId,
          NameOrg1: sName,
          CreatedBy: oData.crusr || "",
          CreatedOn: oData.crdat || null,
          ChangedBy: oData.chusr || "",
          ChangedOn: oData.chdat || null,
          CompanyStatus: oData.company_status || "",
          CompanyStatusCode: oData.company_status_code || "",
          CompanyStatusText: oData.company_status_txt || "",
          RejectReason: "",
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
            FileName: r.filename || "",
            DocumentName: r.document_name || "",
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

    loadRejectReason: function (sPartner) {
      if (!sPartner) {
        return Promise.resolve("");
      }

      return this.readOEntity("/" + this.getODataModel().createKey("CompanyStatus", {
          partner: sPartner
        }),
        {
          urlParameters: {
            $select: "partner,reason"
          }
        }
      ).then(function (oData) {
        return (oData && oData.reason) || "";
      }).catch(function () {
        // console.error("Error loading reject reason:", oError);
        return "";
      });
    },

    onEditPress: function () {
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner");

      if (!sPartner) return;

      sessionStorage.setItem("goToLaunchpad", "");

      this.getRouter().navTo("CompanyEdit", {
        partner: sPartner
      }, true);
    },

    getPdfViewer: function () {
      if (!this._oPdfViewer) {
        this._oPdfViewer = new PDFViewer({
          isTrustedSource: true,
          showDownloadButton: false
        });

        this.getView().addDependent(this._oPdfViewer);
      }

      return this._oPdfViewer;
    },

    normalizePdfBase64: function (sValue) {
      var sCleaned;
      var sDecoded;

      sValue = String(sValue || "").trim();

      if (sValue.indexOf("data:") === 0) {
        return (sValue.split(",")[1] || "").replace(/[\r\n\s]/g, "");
      }

      sCleaned = sValue.replace(/[\r\n\s]/g, "");

      try {
        sDecoded = atob(sCleaned);

        if (
          sDecoded.indexOf("data:") === 0 &&
          sDecoded.indexOf("base64,") > -1
        ) {
          return (sDecoded.split(",")[1] || "").replace(/[\r\n\s]/g, "");
        }
      } catch (e) {}

      if (sCleaned.indexOf(",") > -1) {
        sCleaned = sCleaned.split(",")[1];
      }

      return sCleaned;
    },

    base64ToBlob: function (sBase64, sMimeType) {
      var sByteChars;
      var iSliceSize;
      var aByteArrays;
      var iOffset;
      var sSlice;
      var aByteNumbers;
      var i;

      sMimeType = sMimeType || "application/pdf";

      sBase64 = String(sBase64 || "").trim();

      if (sBase64.indexOf(",") >= 0) {
        sBase64 = sBase64.split(",")[1];
      }

      sBase64 = sBase64.replace(/[\r\n\s]/g, "");

      sByteChars = atob(sBase64);
      iSliceSize = 8192;
      aByteArrays = [];

      for (iOffset = 0; iOffset < sByteChars.length; iOffset += iSliceSize) {
        sSlice = sByteChars.slice(iOffset, iOffset + iSliceSize);
        aByteNumbers = new Array(sSlice.length);

        for (i = 0; i < sSlice.length; i++) {
          aByteNumbers[i] = sSlice.charCodeAt(i);
        }

        aByteArrays.push(new Uint8Array(aByteNumbers));
      }

      return new Blob(aByteArrays, { type: sMimeType });
    },

    _openDocument: function (oDoc) {
      if (!oDoc) {
        return;
      }

      this.setViewBusy(true);

      this.readOEntity("/" + this.getODataModel().createKey("ZCA_COMPANY_DOCS", {
          partner: oDoc.Partner,
          doc_type: oDoc.DocType,
          arc_doc_id: oDoc.ArcDocId
        }),
        {
          urlParameters: {
            $select: "attachment"
          }
        }
      )
        .then(function (oData) {
          var sRaw = oData && oData.attachment ? String(oData.attachment) : "";
          var sPdfB64;
          var sHead;
          var oBlob;
          var sUrl;
          var oPdf;

          if (!sRaw) {
            MessageBox.error(this.getResourceBundle().getText("msgDocNoContent"));
            return;
          }

          try {
            sPdfB64 = this.normalizePdfBase64(sRaw);
            sHead = atob(sPdfB64.substring(0, 32));

            if (sHead.indexOf("%PDF-") !== 0) {
              MessageBox.error(this.getResourceBundle().getText("msgErrorOpenDoc"));
              return;
            }

            oBlob = this.base64ToBlob(sPdfB64, "application/pdf");
            sUrl = URL.createObjectURL(oBlob);

            if (this._sLastPdfUrl) {
              try {
                URL.revokeObjectURL(this._sLastPdfUrl);
              } catch (e) {}
            }

            this._sLastPdfUrl = sUrl;

            if (sap && sap.base && sap.base.security && sap.base.security.URLWhitelist) {
              try {
                sap.base.security.URLWhitelist.add("blob");
              } catch (e) {}
            } else if (jQuery && jQuery.sap && jQuery.sap.addUrlWhitelist) {
              try {
                jQuery.sap.addUrlWhitelist("blob");
              } catch (e) {}
            }

            oPdf = this.getPdfViewer();
            oPdf.setTitle(oDoc.DocTitle || oDoc.FileName || "PDF");
            oPdf.setSource(sUrl);
            oPdf.open();
          } catch (e) {
            MessageBox.error(this.getResourceBundle().getText("msgErrorOpenDoc"));
          }
        }.bind(this))
        .catch(function (oError) {
          this.showODataError(
            oError,
            this.getResourceBundle().getText("msgErrorOpenDoc")
          );
        }.bind(this))
        .finally(function () {
          this.setViewBusy(false);
        }.bind(this));
    },

    onOpenCompanyDocument: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext("CompanyDocumentsData");
      var oDoc = oCtx && oCtx.getObject();

      return this._openDocument(oDoc);
    },

    getApprovalDialog: function () {
      if (this._pApprovalDialog) {
        return this._pApprovalDialog;
      }

      this._pApprovalDialog = this.loadFragment({
        name: "zcacompanymanagement.view.fragments.ApprovalDialog"
      }).then(
        function (oDialog) {
          this.getView().addDependent(oDialog);
          this._oApprovalDialog = oDialog;
          return oDialog;
        }.bind(this)
      );

      return this._pApprovalDialog;
    },

    onRejectPress: function () {
      var oRB = this.getResourceBundle();
      var oApprovalData = this._getEmptyApprovalData();

      oApprovalData.Action = "REJECT";
      oApprovalData.Title = oRB.getText("rejectCompanyTitle");
      oApprovalData.ConfirmText = oRB.getText("reject");

      this.getModel("ApprovalData").setData(oApprovalData);

      this.getApprovalDialog().then(
        function (oDialog) {
          oDialog.open();
          this._sortReasonCombo();
        }.bind(this)
      );
    },

    onApprovePress: function () {
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner");

      if (!sPartner) return;

      MessageBox.confirm(this.getResourceBundle().getText("approveCompanyMessage"), {
        title: this.getResourceBundle().getText("approveCompanyTitle"),
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) {
            return;
          }

          this.setViewBusy(true);

          this.createOEntity("/CompanyStatus", {
            partner: sPartner,
            action: "APPROVE",
            reason: ""
          })
            .then(
              function () {
                return this.loadDisplayData(sPartner);
              }.bind(this)
            )
            .then(
              function () {
                MessageBox.success(
                  this.getResourceBundle().getText("msgCompanyApproved")
                );
              }.bind(this)
            )
            .catch(
              function (oError) {
                return this.loadDisplayData(sPartner).finally(
                  function () {
                    this.showODataError(
                      oError,
                      this.getResourceBundle().getText("msgErrorApproveCompany")
                    );
                  }.bind(this)
                );
              }.bind(this)
            )
            .finally(
              function () {
                this.setViewBusy(false);
              }.bind(this)
            );
        }.bind(this)
      });
    },

    onApprovalDialogConfirm: function () {
      var oApproval = this.getModel("ApprovalData").getData() || {};
      var sPartner = this._sCurrentPartner || this.getModel("CompanyData").getProperty("/Partner");
      var aReasons = oApproval.SavedReasons || [];
      var sPayload;

      if (!sPartner) {
        return;
      }

      if (!aReasons.length) {
        MessageBox.error(this.getResourceBundle().getText("msgRejectReasonRequired"));
        return;
      }

      sPayload = JSON.stringify(
        aReasons.map(function (r) {
          return {
            gr_reason: r.gr_reason,
            id_reason: r.id_reason,
            ar_object: r.ar_object || "",
            free_text: r.free_text || ""
          };
        })
      );

      if (this._oApprovalDialog) {
        this._oApprovalDialog.close();
      }

      this.setViewBusy(true);

      this.createOEntity("/CompanyStatus", {
        partner: sPartner,
        action: "REJECT",
        reason: sPayload
      })
        .then(
          function () {
            return this.loadDisplayData(sPartner);
          }.bind(this)
        )
        .then(
          function () {
            MessageBox.success(
              this.getResourceBundle().getText("msgCompanyRejected")
            );
          }.bind(this)
        )
        .catch(
          function (oError) {
            return this.loadDisplayData(sPartner).finally(
              function () {
                this.showODataError(
                  oError,
                  this.getResourceBundle().getText("msgErrorRejectCompany")
                );
              }.bind(this)
            );
          }.bind(this)
        )
        .finally(
          function () {
            this.setViewBusy(false);
          }.bind(this)
        );
    },

    onApprovalDialogCancel: function () {
      if (this._oApprovalDialog) {
        this._oApprovalDialog.close();
      }
    },

    onDocTypeChange: function (oEvent) {
      var oApproval = this.getModel("ApprovalData");
      var oItem = oEvent.getParameter("selectedItem");
      var oCtx;
      var oObj;

      if (!oItem) {
        oApproval.setProperty("/ArObject", "");
        oApproval.setProperty("/ArObjectText", "");
        return;
      }

      oCtx = oItem.getBindingContext();
      oObj = oCtx ? oCtx.getObject() : null;

      oApproval.setProperty("/ArObject", oItem.getKey());
      oApproval.setProperty("/ArObjectText", oObj && oObj.doctype_txt ? oObj.doctype_txt : oItem.getText());
    },

    onRejectReasonChange: function (oEvent) {
      var oItem = oEvent.getParameter("selectedItem");
      var oApproval = this.getModel("ApprovalData");
      var oCtx;
      var oObj;
      var sGroup;

      if (!oItem) {
        oApproval.setProperty("/SelectedReasonKey", "");
        oApproval.setProperty("/SelectedGrReason", "");
        oApproval.setProperty("/SelectedGrReasonText", "");
        oApproval.setProperty("/SelectedIdReason", "");
        oApproval.setProperty("/SelectedReasonText", "");
        oApproval.setProperty("/ArObject", "");
        oApproval.setProperty("/ArObjectText", "");
        oApproval.setProperty("/FreeText", "");
        oApproval.setProperty("/IsDoc", false);
        oApproval.setProperty("/IsOther", false);
        return;
      }

      oCtx = oItem.getBindingContext();
      oObj = oCtx ? oCtx.getObject() : null;
      sGroup = oObj && oObj.gr_reason ? oObj.gr_reason : "";

      oApproval.setProperty("/SelectedReasonKey", oItem.getKey());
      oApproval.setProperty("/SelectedGrReason", sGroup);
      oApproval.setProperty("/SelectedGrReasonText", oObj && oObj.gr_reason_txt ? oObj.gr_reason_txt : sGroup);
      oApproval.setProperty("/SelectedIdReason", oObj && oObj.id_reason ? oObj.id_reason : "");
      oApproval.setProperty("/SelectedReasonText", oObj && oObj.reason_txt ? oObj.reason_txt : "");
      oApproval.setProperty("/IsDoc", sGroup === "DOC");
      oApproval.setProperty("/IsOther", sGroup === "OTH");

      if (sGroup !== "DOC") {
        oApproval.setProperty("/ArObject", "");
        oApproval.setProperty("/ArObjectText", "");
      }

      if (sGroup !== "OTH") {
        oApproval.setProperty("/FreeText", "");
      }
    },

    onAddReasonPress: function () {
      var oApproval = this.getModel("ApprovalData");
      var aSaved = oApproval.getProperty("/SavedReasons") || [];
      var sGrReason = oApproval.getProperty("/SelectedGrReason");
      var sGrReasonText = oApproval.getProperty("/SelectedGrReasonText");
      var sIdReason = oApproval.getProperty("/SelectedIdReason");
      var sReasonText = oApproval.getProperty("/SelectedReasonText");
      var sArObject = oApproval.getProperty("/ArObject") || "";
      var sArObjectText = oApproval.getProperty("/ArObjectText") || "";
      var sFreeText = (oApproval.getProperty("/FreeText") || "").trim();
      var sDisplayText = sReasonText;
      var bExists;

      if (!sGrReason || !sIdReason) {
        MessageBox.error(this.getResourceBundle().getText("msgRejectReasonRequired"));
        return;
      }

      if (sGrReason === "DOC" && !sArObject) {
        MessageBox.error(this.getResourceBundle().getText("msgRejectDocTypeRequired"));
        return;
      }

      if (sGrReason === "OTH" && !sFreeText) {
        MessageBox.error(this.getResourceBundle().getText("msgRejectFreeTextRequired"));
        return;
      }

      bExists = aSaved.some(function (r) {
        return (
          r.gr_reason === sGrReason &&
          r.id_reason === sIdReason &&
          (r.ar_object || "") === sArObject &&
          (r.free_text || "") === sFreeText
        );
      });

      if (bExists) {
        MessageBox.error(this.getResourceBundle().getText("msgRejectReasonDuplicate"));
        return;
      }

      if (sGrReason === "DOC") {
        sDisplayText = sArObjectText + " - " + sReasonText;
      } else if (sGrReason === "OTH") {
        sDisplayText = sReasonText + " - " + sFreeText;
      }

      aSaved.push({
        gr_reason: sGrReason,
        id_reason: sIdReason,
        ar_object: sArObject,
        free_text: sFreeText,
        group: sGrReasonText,
        displayText: sDisplayText
      });

      oApproval.setProperty("/SavedReasons", aSaved);
      oApproval.setProperty("/HasSavedReasons", aSaved.length > 0);
      oApproval.setProperty("/SelectedReasonKey", "");
      oApproval.setProperty("/SelectedGrReason", "");
      oApproval.setProperty("/SelectedGrReasonText", "");
      oApproval.setProperty("/SelectedIdReason", "");
      oApproval.setProperty("/SelectedReasonText", "");
      oApproval.setProperty("/ArObject", "");
      oApproval.setProperty("/ArObjectText", "");
      oApproval.setProperty("/FreeText", "");
      oApproval.setProperty("/IsDoc", false);
      oApproval.setProperty("/IsOther", false);
    },

    onRemoveSavedReasonPress: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext("ApprovalData");
      var oApproval = this.getModel("ApprovalData");
      var aSaved = oApproval.getProperty("/SavedReasons") || [];
      var sPath;
      var iIndex;

      if (!oCtx) return;

      sPath = oCtx.getPath();
      iIndex = parseInt(sPath.split("/").pop(), 10);

      if (isNaN(iIndex) || iIndex < 0) {
        return;
      }

      aSaved.splice(iIndex, 1);

      oApproval.setProperty("/SavedReasons", aSaved);
      oApproval.setProperty("/HasSavedReasons", aSaved.length > 0);
    },

    _sortReasonCombo: function () {
      var oComboBox = this.byId("reasonCombo");
      var oBinding;

      if (!oComboBox) return;

      oBinding = oComboBox.getBinding("items");

      if (!oBinding) return;

      oBinding.sort([
        new Sorter("gr_position", false, function (oContext) {
          return {
            key: oContext.getProperty("gr_reason"),
            text: oContext.getProperty("gr_reason_txt")
          };
        }),
        new Sorter("id_reason", false)
      ]);
    },
  });
});