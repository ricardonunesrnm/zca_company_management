sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/m/MessageBox"],
  function (Controller, MessageBox) {
    "use strict";

    var CAModel;

    return Controller.extend("zcacompanymanagement.controller.BaseController", {

      getModelCA: function () {
        return CAModel;
      },

      setModelCA: function (token) {
          var userLanguage = sessionStorage.getItem("oLangu");
          if (!userLanguage) {
              userLanguage = "PT";
          }
          var serviceUrlWithLanguage = '/sap/opu/odata/sap/ZODCA_COMPANY_MANAGEMENT_SRV?sap-language=' + sessionStorage.getItem("oLangu"); 
          CAModel = new sap.ui.model.odata.v2.ODataModel({
              serviceUrl: serviceUrlWithLanguage,
              annotationURI: "/zsrv_iwfnd/Annotations(TechnicalName='ZODCA_COMPANY_MANAGEMEN_ANNO_MDL',Version='0001')/$value/",
              headers: {
                  "authorization": token,
                  "applicationName": "ZCA_COMPANY"
              }
          });

          this.setModel(CAModel);
      },

      getUserAuthentication: function (type) {
        var that = this,
          urlParams = new URLSearchParams(window.location.search),
          token = urlParams.get("token");

        if (token != null) {
          var headers = new Headers();
          headers.append("X-authorization", token);

          var requestOptions = {
            method: "GET",
            headers: headers,
            redirect: "follow",
          };

          fetch(
            "/sap/opu/odata/sap/ZODCA_AUTHENTICATOR_SRV/USER_AUTHENTICATION",
            requestOptions,
          )
            .then(function (response) {
              if (!response.ok) {
                throw new Error("Ocorreu um erro ao ler a entidade.");
              }
              return response.text();
            })
            .then(function (xml) {
              var parser = new DOMParser(),
                xmlDoc = parser.parseFromString(xml, "text/xml"),
                successResponseElement =
                  xmlDoc.getElementsByTagName("d:SuccessResponse")[0],
                response = successResponseElement.textContent;

              if (response != "X") {
                that.getRouter().navTo("NotFound");
              } else {
                that.getModel("appView").setProperty("/token", token);
              }
            })
            .catch(function (error) {
              console.error(error);
            });
        } else {
          that.getRouter().navTo("NotFound");
          return;
        }
      },

      getRouter: function () {
        return this.getOwnerComponent().getRouter();
      },

      getModel: function (sName) {
        return this.getView().getModel(sName);
      },

      getODataModel: function () {
        return this.getOwnerComponent().getModel();
      },

      setModel: function (oModel, sName) {
        return this.getView().setModel(oModel, sName);
      },

      getResourceBundle: function () {
        return this.getOwnerComponent().getModel("i18n").getResourceBundle();
      },

      onNavigation: function (sPath, oRoute, oEntityName) {
        if (sPath) {
          this.getRouter().navTo(oRoute, { objectId: sPath.replace(oEntityName, "") }, true);
        } else {
          this.getRouter().navTo(oRoute, {}, false, true);
        }
      },

      setViewBusy: function (bBusy) {
        this.getView().setBusy(!!bBusy);
      },

      setControlBusy: function (oControl, bBusy) {
        if (oControl && oControl.setBusy) {
          oControl.setBusy(!!bBusy);
        }
      },

      getODataErrorMessage: function (oError, sFallbackMessage) {
        try {
          if (oError && oError.responseText) {
            var oErr = JSON.parse(oError.responseText);
            if (
              oErr &&
              oErr.error &&
              oErr.error.message &&
              oErr.error.message.value
            ) {
              return oErr.error.message.value;
            }
          }
        } catch (e) {}

        return (
          sFallbackMessage ||
          this.getResourceBundle().getText("msgUnexpectedError")
        );
      },

      showODataError: function (oError, sFallbackMessage) {
        MessageBox.error(this.getODataErrorMessage(oError, sFallbackMessage));
      },

      readOEntity: function (sPath, mParameters) {
        var oModel = this.getODataModel();

        return new Promise(function (resolve, reject) {
          oModel.read(
            sPath,
            Object.assign({}, mParameters, {
              success: resolve,
              error: reject,
            }),
          );
        });
      },

      createOEntity: function (sPath, oPayload, mParameters) {
        var oModel = this.getODataModel();

        return new Promise(function (resolve, reject) {
          oModel.create(
            sPath,
            oPayload,
            Object.assign({}, mParameters, {
              success: resolve,
              error: reject,
            }),
          );
        });
      },

      updateOEntity: function (sPath, oPayload, mParameters) {
        var oModel = this.getODataModel();

        return new Promise(function (resolve, reject) {
          oModel.update(
            sPath,
            oPayload,
            Object.assign({}, mParameters, {
              success: resolve,
              error: reject,
            }),
          );
        });
      },

      deleteOEntity: function (sPath, mParameters) {
        var oModel = this.getODataModel();

        return new Promise(function (resolve, reject) {
          oModel.remove(
            sPath,
            Object.assign({}, mParameters, {
              success: resolve,
              error: reject,
            }),
          );
        });
      },

      setShellBackButton: function (fnCallback) {
        if (this._fnShellBackButton) {
          window.removeEventListener("message", this._fnShellBackButton);
          this._fnShellBackButton = null;
        }

        if (typeof fnCallback !== "function") {
          return;
        }

        this._fnShellBackButton = function (oEvent) {
          var oData = oEvent.data;

          if (oData && oData.action === "goToMainPage") {
            fnCallback.call(this, oEvent);
          }
        }.bind(this);

        window.addEventListener("message", this._fnShellBackButton);
      },
    });
  },
);
