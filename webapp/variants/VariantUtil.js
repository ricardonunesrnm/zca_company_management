sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast"
], function (BaseObject, Fragment, Filter, FilterOperator, Sorter, MessageToast) {
    "use strict";

    const VariantUtil = BaseObject.extend("ca.crossapp.utils.VariantUtil", {

        // =====================================================================
        // Public API
        // =====================================================================

        /**
         * Attaches all VariantUtil handlers to a controller instance and initializes
         * internal state used by variants handling.
         *
         * @param {sap.ui.core.mvc.Controller} oController Controller instance to attach handlers to.
         * @param {object} [mConfig] Optional configuration overrides.
         * @returns {sap.ui.core.mvc.Controller} The same controller instance for chaining.
         */
        handleAttachToController: function (oController, mConfig) {
            oController._oVariantCfg = Object.assign({
                variantModel: "vModel",
                mainModel: "appView",
                btnVariantId: "btnVariant",
                variantSetPath: "/ZCA_USR_VARIANTS_DD",
                smartFilterBarId: "smartFilterBar",
                smartTableId: "smartTable",

                fragVariantListPrefix: "VariantList",
                fragManagePrefix: "VariantManage",
                fragSavePrefix: "VariantSave",

                fragVariantListName: "zcacompanymanagement.variants.fragments.VariantListPopover",
                fragManageName: "zcacompanymanagement.variants.fragments.VariantManageDialog",
                fragSaveName: "zcacompanymanagement.variants.fragments.VariantSaveDialog"
            }, mConfig || {});

            const oProto = Object.getPrototypeOf(this);
            const aHandlers = Object.getOwnPropertyNames(oProto).filter(function (sName) {
                return sName !== "constructor" &&
                    sName !== "handleAttachToController" &&
                    typeof oProto[sName] === "function";
            });

            // Bind handlers to the controller instance
            aHandlers.forEach((sName) => {
                if (typeof this[sName] === "function") {
                    oController[sName] = this[sName].bind(oController);
                }
            });

            // Initialize internal caches/state
            oController._mVariantFragments = oController._mVariantFragments || {};
            oController._aVariantDeleteQueue = oController._aVariantDeleteQueue || [];
            oController._mManageSnapshot = oController._mManageSnapshot || {};

            // Initialize main model defaults
            const oMain = oController.getModel(oController._oVariantCfg.mainModel);
            if (oMain) {
                if (!oMain.getProperty("/variantInput")) oMain.setProperty("/variantInput", "Standard");
                if (!oMain.getProperty("/selectedVariant")) oMain.setProperty("/selectedVariant", "Main");
                if (oMain.getProperty("/selectedVariantAuto") === undefined) oMain.setProperty("/selectedVariantAuto", false);
            }

            // Ensure table rebind hook is attached once
            oController.handleEnsureAfterRebindHook();

            return oController;
        },

        /**
         * Ensures an afterRebindTable hook is attached once to re-apply pending
         * column visibility and table state after rebinds.
         *
         * @returns {void}
         */
        handleEnsureAfterRebindHook: function () {
            const oMain = this.handleGetMainModel();
            if (!oMain) return;

            if (oMain.getProperty("/_colHooked")) return;

            const oSmartTable = this.handleGetSmartTable();
            if (!oSmartTable || typeof oSmartTable.attachAfterRebindTable !== "function") return;

            oMain.setProperty("/_colHooked", true);

            oSmartTable.attachAfterRebindTable(function () {
                const aKeys = this.handleConsumePendingColumnKeys();
                if (Array.isArray(aKeys) && aKeys.length) {
                    this.handleApplyColumnsByKeys(aKeys);
                }

                const oState = this.handleConsumePendingTableState();
                if (oState) {
                    this.handleApplySmartTableValues(oState);
                }
            }.bind(this));
        },

        /**
         * Loads variants from backend and applies the appropriate initial variant
         * (auto-apply > default > standard).
         *
         * @returns {void}
         */
        handleStartVariants: function () {
            this.handleEnsureStandardCaptured();
            this.handleEnsureAfterRebindHook();

            const oModel = this.handleGetVariantModel();
            const that = this;

            oModel.read(this.handleGetCfg().variantSetPath, {

                
                success: function (oData) {
                    const aAll = (oData && oData.results) || [];

                    if (!aAll.length) {
                        that.handleSetStandardSelected();
                        that.handleApplyStandard();
                        return;
                    }

                    const aActive = aAll.filter(function (x) { return !x.del; });
                    if (!aActive.length) {
                        that.handleSetStandardSelected();
                        that.handleApplyStandard();
                        return;
                    }

                    const oAuto = aActive.find(function (x) { return !!x.v_apply_auto; });
                    const oDef = aActive.find(function (x) { return !!x.v_default; }) ||
                        aActive.find(function (x) { return x.variant_id === "Main"; });

                    const oPick = oAuto || oDef;
                    if (!oPick) return;

                    that.handleGetMainModel().setProperty("/selectedVariant", oPick.variant_id);
                    that.handleGetMainModel().setProperty("/variantInput", oPick.v_name);
                    that.handleGetMainModel().setProperty("/selectedVariantAuto", !!oPick.v_apply_auto);

                    if (oPick.variant_id !== "Main") {
                        that.handleApplyVariantObject(oPick);
                    } else {
                        that.handleApplyStandard();
                    }
                },
                error: function () { }
            });
        },

        // =====================================================================
        // View Event Handlers (XML / Controllers)
        // =====================================================================

        /**
         * Opens the variant list popover.
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onShowVariantList: function (oEvent) {
            const cfg = this.handleGetCfg();
            const oSource = oEvent && oEvent.getSource && oEvent.getSource();
            const oAnchor = oSource || this.byId(cfg.btnVariantId);

            this.handleLoadFragment(cfg.fragVariantListPrefix, cfg.fragVariantListName).then(function () {
                const oPopover = this.handleGetPopover();
                if (!oPopover) return;

                this.handleSyncVariantListSelection();

                if (oAnchor) oPopover.openBy(oAnchor);
                else oPopover.open();
            }.bind(this));
        },

        /**
         * Syncs selection after list items update.
         *
         * @returns {void}
         */
        onVariantListUpdateFinished: function () {
            this.handleSyncVariantListSelection();
        },

        /**
         * Applies the selected variant from the list.
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onVariantListSelectionChange: function (oEvent) {
            const oItem = oEvent.getParameter("listItem");
            if (!oItem) return;

            const oCtx = oItem.getBindingContext(this.handleGetCfg().variantModel);
            if (!oCtx) return;

            this.handleApplyVariantFromContext(oCtx);

            const oPopover = this.handleGetPopover();
            oPopover && oPopover.close();
        },

        /**
         * Opens the manage variants dialog.
         *
         * @returns {void}
         */
        onVariantManagePress: function () {
            const cfg = this.handleGetCfg();

            const oPopover = this.handleGetPopover();
            oPopover && oPopover.close();

            this.handleClearVariantDeleteMarks();
            this._mManageSnapshot = {};

            const oModel = this.handleGetVariantModel();
            if (oModel && typeof oModel.resetChanges === "function") {
                oModel.resetChanges();
            }

            this.handleLoadFragment(cfg.fragManagePrefix, cfg.fragManageName).then(function () {
                const oDialog = this.handleGetManageDialog();
                if (!oDialog) return;

                oDialog.open();

                setTimeout(function () {
                    this.handleCaptureManageSnapshot();
                }.bind(this), 0);
            }.bind(this));
        },

        /**
         * Closes the manage variants dialog.
         *
         * @returns {void}
         */
        onVariantManageClose: function () {
            const oDialog = this.handleGetManageDialog();
            oDialog && oDialog.close();
        },

        /**
         * Handles the search input in the manage dialog.
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onManageSearch: function (oEvent) {
            this._sManageSearch = (oEvent.getSource().getValue() || "");
            this.handleApplyManageSearchFilter();
        },

        /**
         * Handles default variant selection (including the virtual "Main").
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onVariantDefaultSelect: function (oEvent) {
            const cfg = this.handleGetCfg();
            const oRB = oEvent.getSource();
            const oCtx = oRB.getBindingContext(cfg.variantModel);
            if (!oCtx) return;

            const oObj = oCtx.getObject();
            if (!oObj) return;

            const sId = this.handleNormalizeVariantId(oObj.variant_id);

            const oModel = this.handleGetVariantModel();
            const oTable = this.handleGetManageTable();
            if (!oModel || !oTable) return;

            if (sId !== "Main" && oObj.del) return;

            oTable.getItems().forEach(function (it) {
                const c = it.getBindingContext(cfg.variantModel);
                if (!c) return;

                const o = c.getObject();
                if (!o) return;

                const id = this.handleNormalizeVariantId(o.variant_id);

                if (sId === "Main") {
                    oModel.setProperty(c.getPath() + "/v_default", id === "Main");
                    if (id !== "Main") {
                        oModel.setProperty(c.getPath() + "/v_default", false);
                    }
                    return;
                }

                if (id === "Main") {
                    oModel.setProperty(c.getPath() + "/v_default", false);
                    return;
                }

                if (o.del) {
                    oModel.setProperty(c.getPath() + "/v_default", false);
                    return;
                }

                oModel.setProperty(c.getPath() + "/v_default", id === sId);
            }.bind(this));

            oModel.checkUpdate(true);
            sap.ui.getCore().applyChanges();
        },

        /**
         * Toggles soft-delete mark for a variant in the manage table.
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onVariantDeletePress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext(this.handleGetCfg().variantModel);
            if (!oCtx) return;
            this.handleToggleVariantDeleteMark(oCtx);
        },

        /**
         * Saves manage dialog changes to backend using sequential update calls.
         *
         * @returns {void}
         */
        onVariantManageSave: function () {
            const oModel = this.handleGetVariantModel();
            if (!oModel) return;

            const oDialog = this.handleGetManageDialog();

            const sSelectedBefore = this.handleNormalizeVariantId(
                this.handleGetMainModel().getProperty("/selectedVariant") || "Main"
            );

            const bSelectedDeleted = (function () {
                const oTable = this.handleGetManageTable();
                const cfg = this.handleGetCfg();
                if (!oTable) return false;

                const aItems = oTable.getItems() || [];
                return aItems.some(function (it) {
                    const c = it.getBindingContext(cfg.variantModel);
                    if (!c) return false;

                    const o = c.getObject();
                    if (!o) return false;

                    return this.handleNormalizeVariantId(o.variant_id) === sSelectedBefore && !!o.del;
                }.bind(this));
            }.bind(this))();

            this.handleEnsureDefaultValidInManage();

            const aOps = this.handleBuildManageUpdates();

            let i = 0;
            let iErrors = 0;

            const finish = function () {
                oModel.refresh(true);

                if (bSelectedDeleted) {
                    this.handleSetStandardSelected();
                    this.handleApplyStandard();
                }

                this._aVariantDeleteQueue = [];
                this._mManageSnapshot = {};

                if (iErrors > 0) {
                    MessageToast.show("Some changes could not be saved. Please check logs.");
                }

                oDialog && oDialog.close();
            }.bind(this);

            const next = function () {
                if (i >= aOps.length) {
                    finish();
                    return;
                }

                const op = aOps[i++];
                if (!op || !op.path) {
                    next();
                    return;
                }

                oModel.update(op.path, op.data, {
                    merge: true,
                    refreshAfterChange: false,
                    success: function () { next(); },
                    error: function () { iErrors++; next(); }
                });
            };

            if (!aOps.length) {
                finish();
                return;
            }

            next();
        },

        /**
         * Cancels manage dialog changes and resets any soft-delete marks.
         *
         * @returns {void}
         */
        onVariantManageCancel: function () {
            const oModel = this.handleGetVariantModel();
            if (oModel && typeof oModel.resetChanges === "function") {
                oModel.resetChanges();
            }

            this.handleClearVariantDeleteMarks();
            this._mManageSnapshot = {};

            const oDialog = this.handleGetManageDialog();
            oDialog && oDialog.close();
        },

        /**
         * Opens the save-as dialog.
         *
         * @returns {void}
         */
        onVariantSaveAsPress: function () {
            const cfg = this.handleGetCfg();

            const oPopover = this.handleGetPopover();
            oPopover && oPopover.close();

            this.handleGetMainModel().setProperty("/variantDraft", { name: "", "default": false });

            this.handleLoadFragment(cfg.fragSavePrefix, cfg.fragSaveName).then(function () {
                const oDialog = this.handleGetSaveDialog();
                oDialog && oDialog.open();
            }.bind(this));
        },

        /**
         * Confirms save-as and creates a new variant entry.
         *
         * @returns {void}
         */
        onVariantSaveConfirm: function () {
            const oDraft = this.handleGetMainModel().getProperty("/variantDraft") || {};
            const sName = (oDraft.name || "").trim();
            const bDefault = !!oDraft["default"];

            if (!sName) {
                MessageToast.show("Please provide a name.");
                return;
            }

            this.handleCreateVariant(sName, bDefault);

            const oDialog = this.handleGetSaveDialog();
            oDialog && oDialog.close();
        },

        /**
         * Cancels save-as dialog.
         *
         * @returns {void}
         */
        onVariantSaveCancel: function () {
            const oDialog = this.handleGetSaveDialog();
            oDialog && oDialog.close();
        },

        /**
         * Captures filter bar visibility changes into a base64 string in the main model.
         *
         * @param {sap.ui.base.Event} oEvent Event instance.
         * @returns {void}
         */
        onFilterChange: function (oEvent) {
            const aItems = oEvent.getSource().getFilterGroupItems();
            const aVisible = aItems
                .filter(function (oItem) { return oItem.getVisibleInFilterBar(); })
                .map(function (oItem) { return ({ name: oItem.getName(), visibleInFilterBar: true }); });

            this.handleGetMainModel().setProperty("/fbarBtoa", btoa(JSON.stringify(aVisible)));
        },

        /**
         * Applies filter bar configuration (and optionally values) based on saved settings.
         *
         * @param {object[]} aFbSettings Filter bar configuration array.
         * @param {boolean} bOnlyVisibility If true, only visibility is applied.
         * @returns {void}
         */
        onUpdateFilterBar: function (aFbSettings, bOnlyVisibility) {
            if (!Array.isArray(aFbSettings) || !aFbSettings.length) return;

            const oFilterBar = this.handleGetSmartFilterBar();
            const aItems = oFilterBar.getFilterGroupItems();

            aItems.forEach(function (oItem) { oItem.setVisibleInFilterBar(false); });

            const mByName = {};
            aFbSettings.forEach(function (s) { mByName[s.name] = s; });

            aItems.forEach(function (oItem) {
                const oSaved = mByName[oItem.getName()];
                if (!oSaved) return;

                oItem.setVisibleInFilterBar(true);

                if (bOnlyVisibility) return;

                const oControl = oItem.getControl();
                const aFilters = oSaved.aFilters;
                if (!aFilters || !aFilters.length) return;

                const oFilter = aFilters[0];
                if (oControl instanceof sap.m.Input || oControl instanceof sap.m.MultiInput) {
                    oControl.setValue(oFilter.oValue1);
                } else if (oControl instanceof sap.m.Select || oControl instanceof sap.m.ComboBox) {
                    oControl.setSelectedKey(oFilter.oValue1);
                } else if (oControl instanceof sap.m.CheckBox) {
                    oControl.setSelected(oFilter.oValue1 === "true" || oFilter.oValue1 === true);
                }
            });
        },

        // =====================================================================
        // View Formatters (XML)
        // =====================================================================

        /**
         * Formatter: returns the icon for the soft-delete action.
         *
         * @param {string} sVariantId Variant identifier.
         * @returns {string} Icon URI.
         */
        onFmtDeleteIcon: function (sVariantId) {
            return this.handleIsVariantMarkedForDelete(sVariantId) ? "sap-icon://undo" : "sap-icon://decline";
        },

        /**
         * Formatter: returns the tooltip for the soft-delete action.
         *
         * @param {string} sVariantId Variant identifier.
         * @returns {string} Tooltip text.
         */
        onFmtDeleteTooltip: function (sVariantId) {
            return this.handleIsVariantMarkedForDelete(sVariantId) ? "Undo" : "Delete";
        },

        /**
         * Formatter: returns row highlight when soft-deleted.
         *
         * @param {string} sVariantId Variant identifier.
         * @returns {string} Highlight enum value.
         */
        onFmtRowHighlight: function (sVariantId) {
            return this.handleIsVariantMarkedForDelete(sVariantId) ? "Warning" : "None";
        },

        // =====================================================================
        // Apply / Selection / Core actions
        // =====================================================================

        /**
         * Applies the currently selected item from list context.
         *
         * @param {sap.ui.model.Context} oCtx Binding context.
         * @returns {void}
         */
        handleApplyVariantFromContext: function (oCtx) {
            const oObj = this.handleGetVariantModel().getObject(oCtx.getPath());
            if (!oObj) return;

            if (oObj.del) {
                MessageToast.show("This variant is marked for deletion.");
                return;
            }

            this.handleGetMainModel().setProperty("/selectedVariant", oObj.variant_id);
            this.handleGetMainModel().setProperty("/variantInput", oObj.v_name);
            this.handleGetMainModel().setProperty("/selectedVariantAuto", !!oObj.v_apply_auto);

            if (oObj.variant_id !== "Main") {
                this.handleApplyVariantObject(oObj);
            } else {
                this.handleApplyStandard();
            }
        },

        /**
         * Applies a variant object to the SmartFilterBar and SmartTable.
         *
         * @param {object} oVariant Variant entity object.
         * @returns {void}
         */
        handleApplyVariantObject: function (oVariant) {
            this.handleEnsureAfterRebindHook();

            this.handleClearFilterBar();

            let aFb = [];
            try { aFb = JSON.parse(atob(oVariant.fbar_settings || btoa("[]"))); } catch (e) { aFb = []; }

            const bHasFbValues = !!(oVariant.fbar_values && oVariant.fbar_values !== "");
            this.onUpdateFilterBar(aFb, bHasFbValues);

            let aCols = [];
            try { aCols = JSON.parse(atob(oVariant.stable_settings || btoa("[]"))); } catch (e2) { aCols = []; }
            const aKeys = aCols.map(function (o) { return o.name; }).filter(Boolean);

            if (aKeys.length) {
                this.handleApplyColumnsByKeys(aKeys);
                this.handleGetMainModel().setProperty("/oSmartTableView", aKeys.join(","));
            }
            this.handleSetPendingColumnKeys(aKeys);

            if (bHasFbValues) {
                this.handleApplyFilterBarValues(oVariant.fbar_values);
            }

            let oStableState = null;
            if (oVariant.stable_values) {
                try { oStableState = JSON.parse(atob(oVariant.stable_values || btoa("{}"))); } catch (e3) { oStableState = null; }
            }
            if (oStableState) {
                this.handleSetPendingTableState(oStableState);
            }

            this.handleSearchTable(true);
        },

        /**
         * Applies the "Standard" (virtual) variant.
         *
         * @returns {void}
         */
        handleApplyStandard: function () {
            this.handleEnsureAfterRebindHook();
            this.handleEnsureStandardCaptured();

            this.handleResetFilterBarToInitial();

            const aStd = this.handleGetMainModel().getProperty("/vStandard");
            if (Array.isArray(aStd) && aStd.length) {
                this.onUpdateFilterBar(aStd, true);
            }

            const aStdKeys = this.handleGetMainModel().getProperty("/oStandardKeys") || [];
            if (Array.isArray(aStdKeys) && aStdKeys.length) {
                this.handleApplyColumnsByKeys(aStdKeys);
                this.handleGetMainModel().setProperty("/oSmartTableView", aStdKeys.join(","));
            }
            this.handleSetPendingColumnKeys(aStdKeys);

            const oStdTableState = this.handleGetMainModel().getProperty("/oStandardTableState") || null;
            if (oStdTableState) {
                this.handleSetPendingTableState(oStdTableState);
            }

            this.handleSearchTable();
        },

        /**
         * Ensures a single selection exists in the variant list popover.
         *
         * @returns {void}
         */
        handleSyncVariantListSelection: function () {
            const oList = this.handleGetVariantList();
            if (!oList) return;

            const sSelected = this.handleGetMainModel().getProperty("/selectedVariant") || "Main";
            const aItems = oList.getItems() || [];

            const oToSelect = aItems.find(function (oItem) {
                const oCtx = oItem.getBindingContext(this.handleGetCfg().variantModel);
                return oCtx && oCtx.getProperty("variant_id") === sSelected;
            }.bind(this));

            oToSelect && oList.setSelectedItem(oToSelect, true);
        },

        /**
         * Sets the main model selection to the standard ("Main") variant.
         *
         * @returns {void}
         */
        handleSetStandardSelected: function () {
            this.handleGetMainModel().setProperty("/selectedVariant", "Main");
            this.handleGetMainModel().setProperty("/variantInput", "Standard");
            this.handleGetMainModel().setProperty("/selectedVariantAuto", false);
        },

        // =====================================================================
        // Manage dialog: search, snapshot, updates
        // =====================================================================

        /**
         * Returns the manage dialog search query.
         *
         * @returns {string} Search query string.
         */
        handleGetManageSearchQuery: function () {
            return (this._sManageSearch || "").trim();
        },

        /**
         * Applies the manage dialog search filter (does not hide soft-deleted rows).
         *
         * @returns {void}
         */
        handleApplyManageSearchFilter: function () {
            const oTable = this.handleGetManageTable();
            if (!oTable) return;

            const oBinding = oTable.getBinding("items");
            if (!oBinding) return;

            const aFilters = [];
            const sQuery = this.handleGetManageSearchQuery();
            if (sQuery) {
                aFilters.push(new Filter("v_name", FilterOperator.Contains, sQuery));
            }

            oBinding.filter(aFilters, "Application");

            const oVModel = this.handleGetVariantModel();
            oVModel && typeof oVModel.checkUpdate === "function" && oVModel.checkUpdate(true);
            sap.ui.getCore().applyChanges();
        },

        /**
         * Captures the current state of the manage list for later diffing.
         *
         * @returns {void}
         */
        handleCaptureManageSnapshot: function () {
            const cfg = this.handleGetCfg();
            const oTable = this.handleGetManageTable();
            if (!oTable) return;

            const aItems = oTable.getItems() || [];
            const mSnap = {};

            aItems.forEach(function (it) {
                const c = it.getBindingContext(cfg.variantModel);
                if (!c) return;

                const o = c.getObject();
                if (!o) return;

                const sId = this.handleNormalizeVariantId(o.variant_id);
                if (!sId) return;

                const k = this.handleGetManageSnapshotKey(c);
                if (!k) return;

                mSnap[k] = {
                    variant_id: o.variant_id,
                    v_default: !!o.v_default,
                    v_apply_auto: !!o.v_apply_auto,
                    del: !!o.del,
                    v_name: o.v_name
                };
            }.bind(this));

            this._mManageSnapshot = mSnap;
        },

        /**
         * Returns a stable snapshot key for a given context.
         *
         * @param {sap.ui.model.Context} oCtx Context instance.
         * @returns {string} Snapshot key.
         */
        handleGetManageSnapshotKey: function (oCtx) {
            return oCtx && oCtx.getPath ? oCtx.getPath() : "";
        },

        /**
         * Builds the list of update operations required to persist manage changes.
         * The virtual "Main" entry is never updated.
         *
         * @returns {Array<{path:string,data:object}>} Update operations.
         */
        handleBuildManageUpdates: function () {
            const cfg = this.handleGetCfg();
            const oTable = this.handleGetManageTable();
            if (!oTable) return [];

            const aItems = oTable.getItems() || [];
            const aOps = [];
            const mSnap = this._mManageSnapshot || {};

            aItems.forEach(function (it) {
                const c = it.getBindingContext(cfg.variantModel);
                if (!c) return;

                const o = c.getObject();
                if (!o || o.variant_id === undefined || o.variant_id === null) return;

                const sId = this.handleNormalizeVariantId(o.variant_id);
                if (!sId) return;

                if (sId === "Main") return;

                const sPath = c.getPath();
                if (!sPath) return;

                const k = this.handleGetManageSnapshotKey(c);
                const s = mSnap[k] || null;

                const payload = {
                    v_default: !!o.v_default,
                    v_apply_auto: !!o.v_apply_auto,
                    del: !!o.del
                };

                if (o.v_name !== undefined) payload.v_name = o.v_name;

                let changed = false;
                if (!s) {
                    changed = true;
                } else {
                    if (!!s.v_default !== !!payload.v_default) changed = true;
                    if (!!s.v_apply_auto !== !!payload.v_apply_auto) changed = true;
                    if (!!s.del !== !!payload.del) changed = true;
                    if (payload.v_name !== undefined && s.v_name !== payload.v_name) changed = true;
                }

                if (!changed) return;

                aOps.push({ path: sPath, data: payload });
            }.bind(this));

            return aOps;
        },

        /**
         * Ensures default selection consistency in manage dialog when the virtual
         * "Main" is selected as default.
         *
         * @returns {void}
         */
        handleEnsureDefaultValidInManage: function () {
            const cfg = this.handleGetCfg();
            const oModel = this.handleGetVariantModel();
            const oTable = this.handleGetManageTable();
            if (!oModel || !oTable) return;

            const aItems = oTable.getItems() || [];
            const aCtx = aItems
                .map(function (it) { return it.getBindingContext(cfg.variantModel); })
                .filter(Boolean);

            const oMainCtx = aCtx.find(function (c) {
                const o = c.getObject();
                return o && this.handleNormalizeVariantId(o.variant_id) === "Main";
            }.bind(this)) || null;

            const aReal = aCtx.filter(function (c) {
                const o = c.getObject();
                const id = this.handleNormalizeVariantId(o && o.variant_id);
                return !!id && id !== "Main";
            }.bind(this));

            const aActiveReal = aReal.filter(function (c) {
                const o = c.getObject();
                return o && !o.del;
            });

            if (oMainCtx) {
                const oMain = oMainCtx.getObject();
                if (oMain && oMain.v_default) {
                    aReal.forEach(function (c) {
                        oModel.setProperty(c.getPath() + "/v_default", false);
                    });
                    oModel.checkUpdate(true);
                    return;
                }
            }

            const oDefaultReal = aActiveReal.find(function (c) {
                const o = c.getObject();
                return !!(o && o.v_default);
            });

            if (oDefaultReal) {
                if (oMainCtx) {
                    oModel.setProperty(oMainCtx.getPath() + "/v_default", false);
                }
                oModel.checkUpdate(true);
                return;
            }

            if (aActiveReal.length) {
                const oPick = aActiveReal[0];
                aActiveReal.forEach(function (c) {
                    oModel.setProperty(c.getPath() + "/v_default", c.getPath() === oPick.getPath());
                });
                if (oMainCtx) {
                    oModel.setProperty(oMainCtx.getPath() + "/v_default", false);
                }
                oModel.checkUpdate(true);
                return;
            }

            if (oMainCtx) {
                oModel.setProperty(oMainCtx.getPath() + "/v_default", true);
                oModel.checkUpdate(true);
            }
        },

        // =====================================================================
        // Soft delete support
        // =====================================================================

        /**
         * Normalizes a variant identifier.
         *
         * @param {*} v Variant id.
         * @returns {string} Normalized id.
         */
        handleNormalizeVariantId: function (v) {
            return (v === null || v === undefined) ? "" : String(v).trim();
        },

        /**
         * Checks whether a variant is currently marked for soft deletion.
         *
         * @param {string} sVariantId Variant id.
         * @returns {boolean} True if marked for delete.
         */
        handleIsVariantMarkedForDelete: function (sVariantId) {
            const sNorm = this.handleNormalizeVariantId(sVariantId);
            this._aVariantDeleteQueue = this._aVariantDeleteQueue || [];
            return this._aVariantDeleteQueue.some(function (x) {
                return this.handleNormalizeVariantId(x && (x.norm_id || x.variant_id)) === sNorm;
            }.bind(this));
        },

        /**
         * Toggles the soft-delete mark (del=true) for a manage-row context.
         *
         * @param {sap.ui.model.Context} oCtx Row context.
         * @returns {void}
         */
        handleToggleVariantDeleteMark: function (oCtx) {
            if (!oCtx) return;

            const oObj = oCtx.getObject();
            if (!oObj || oObj.variant_id === undefined || oObj.variant_id === null) return;

            const sIdRaw = oObj.variant_id;
            const sIdNorm = this.handleNormalizeVariantId(sIdRaw);

            if (sIdNorm === "Main") return;

            this._aVariantDeleteQueue = this._aVariantDeleteQueue || [];

            const i = this._aVariantDeleteQueue.findIndex(function (x) {
                return this.handleNormalizeVariantId(x && (x.norm_id || x.variant_id)) === sIdNorm;
            }.bind(this));

            const oModel = this.handleGetVariantModel();

            if (i >= 0) {
                const prev = this._aVariantDeleteQueue[i];
                this._aVariantDeleteQueue.splice(i, 1);

                if (oModel && prev && prev.path) {
                    if (prev.prev_del !== undefined) oModel.setProperty(prev.path + "/del", !!prev.prev_del);
                    if (prev.prev_default !== undefined) oModel.setProperty(prev.path + "/v_default", !!prev.prev_default);
                    if (prev.prev_auto !== undefined) oModel.setProperty(prev.path + "/v_apply_auto", !!prev.prev_auto);
                }
            } else {
                this._aVariantDeleteQueue.push({
                    variant_id: sIdRaw,
                    norm_id: sIdNorm,
                    path: oCtx.getPath(),
                    prev_del: !!oObj.del,
                    prev_default: !!oObj.v_default,
                    prev_auto: !!oObj.v_apply_auto
                });

                if (oModel) {
                    oModel.setProperty(oCtx.getPath() + "/del", true);
                    if (oObj.v_default) oModel.setProperty(oCtx.getPath() + "/v_default", false);
                    if (oObj.v_apply_auto) oModel.setProperty(oCtx.getPath() + "/v_apply_auto", false);
                }
            }

            this.handleApplyManageSearchFilter();

            const oVModel = this.handleGetVariantModel();
            oVModel && typeof oVModel.checkUpdate === "function" && oVModel.checkUpdate(true);
            sap.ui.getCore().applyChanges();
        },

        /**
         * Clears all soft-delete marks and restores previous values.
         *
         * @returns {void}
         */
        handleClearVariantDeleteMarks: function () {
            const oModel = this.handleGetVariantModel();
            const aQueue = this._aVariantDeleteQueue || [];

            aQueue.forEach(function (q) {
                if (!q || !q.path) return;
                if (!oModel) return;

                if (q.prev_del !== undefined) oModel.setProperty(q.path + "/del", !!q.prev_del);
                if (q.prev_default !== undefined) oModel.setProperty(q.path + "/v_default", !!q.prev_default);
                if (q.prev_auto !== undefined) oModel.setProperty(q.path + "/v_apply_auto", !!q.prev_auto);
            });

            this._aVariantDeleteQueue = [];

            this.handleApplyManageSearchFilter();

            const oVModel = this.handleGetVariantModel();
            oVModel && typeof oVModel.checkUpdate === "function" && oVModel.checkUpdate(true);
            sap.ui.getCore().applyChanges();

            const oTable = this.handleGetManageTable();
            const oBinding = oTable && oTable.getBinding("items");
            oBinding && oBinding.refresh && oBinding.refresh(false);
        },

        // =====================================================================
        // Create Variant
        // =====================================================================

        /**
         * Creates a new variant entry in the backend.
         *
         * @param {string} sName Variant name.
         * @param {boolean} bDefault Whether it should be default.
         * @returns {void}
         */
        handleCreateVariant: function (sName, bDefault) {
            const that = this;
            const oModel = this.handleGetVariantModel();

            const oEntry = {
                v_name: sName,
                v_apply_auto: false,
                v_default: bDefault,
                del: false,
                fbar_settings: this.handleSerializeFilterBarVariant(),
                stable_settings: this.handleSerializeSmartTableVariant(),
                fbar_values: this.handleSerializeFilterBarValues(),
                stable_values: this.handleSerializeSmartTableValues()
            };

            oModel.create(this.handleGetCfg().variantSetPath, oEntry, {
                success: function (oCreated) {
                    that.handleGetMainModel().setProperty("/selectedVariant", oCreated.variant_id);
                    that.handleGetMainModel().setProperty("/variantInput", oCreated.v_name || sName);
                    that.handleGetMainModel().setProperty("/selectedVariantAuto", !!oCreated.v_apply_auto);

                    oModel.refresh(true);
                },
                error: function () { }
            });
        },

        // =====================================================================
        // Standard snapshot
        // =====================================================================

        /**
         * Ensures the standard snapshot (filter bar + table state) is captured once.
         *
         * @returns {boolean} True if captured or not required.
         */
        handleEnsureStandardCaptured: function () {
            const oMain = this.handleGetMainModel();
            if (!oMain) return true;
            if (oMain.getProperty("/_stdCaptured")) return true;

            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb) return false;

            if (oSfb.attachInitialized && !oMain.getProperty("/_stdInitHooked")) {
                oMain.setProperty("/_stdInitHooked", true);
                oSfb.attachInitialized(function () {
                    this.handleCaptureStandardSnapshot();
                }.bind(this));
            }

            this.handleCaptureStandardSnapshot();
            return !!oMain.getProperty("/_stdCaptured");
        },

        /**
         * Captures the current screen state as the standard snapshot.
         *
         * @returns {void}
         */
        handleCaptureStandardSnapshot: function () {
            const oMain = this.handleGetMainModel();
            if (!oMain || oMain.getProperty("/_stdCaptured")) return;

            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb) return;

            const aStdFb = oSfb.getFilterGroupItems()
                .filter(function (oItem) { return oItem.getVisibleInFilterBar(); })
                .map(function (oItem) { return ({ name: oItem.getName(), visibleInFilterBar: true }); });

            const aStdKeys = this.handleGetVisibleColumnKeys();
            if (!aStdFb.length && !aStdKeys.length) return;

            let oStdTableState = null;
            try {
                oStdTableState = JSON.parse(atob(this.handleSerializeSmartTableValues() || btoa("{}")));
            } catch (e) {
                oStdTableState = null;
            }

            oMain.setProperty("/vStandard", aStdFb);
            oMain.setProperty("/oStandardKeys", aStdKeys);
            oMain.setProperty("/oStandard", aStdKeys.join(","));
            oMain.setProperty("/oStandardTableState", oStdTableState);
            oMain.setProperty("/_stdCaptured", true);
        },

        // =====================================================================
        // Serialization / Deserialization
        // =====================================================================

        /**
         * Serializes filter bar structure (visibility + filter metadata).
         *
         * @returns {string} Base64 JSON string.
         */
        handleSerializeFilterBarVariant: function () {
            const oFilterBar = this.handleGetSmartFilterBar();
            const aItems = oFilterBar.getFilterGroupItems();

            const aVisible = aItems
                .filter(function (oItem) { return oItem.getVisibleInFilterBar(); })
                .map(function (oItem) { return ({ name: oItem.getName(), visibleInFilterBar: true }); });

            const mByName = {};
            aVisible.forEach(function (x) { mByName[x.name] = x; });

            try {
                oFilterBar.getFilters().forEach(function (oElement) {
                    const aFilters = oElement.aFilters || [];
                    const sPath = aFilters[0] && aFilters[0].sPath;
                    if (sPath && mByName[sPath]) {
                        mByName[sPath].aFilters = aFilters.length ? aFilters : " ";
                    }
                });
            } catch (e) { }

            return btoa(JSON.stringify(aVisible));
        },

        /**
         * Serializes filter bar values.
         *
         * @returns {string} Base64 JSON string.
         */
        handleSerializeFilterBarValues: function () {
            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb) return btoa(JSON.stringify({}));

            const oOut = {};
            try {
                if (typeof oSfb.getFilterData === "function") {
                    oOut.filterData = oSfb.getFilterData(true);
                }
            } catch (e) { }

            return btoa(JSON.stringify(oOut));
        },

        /**
         * Applies filter bar values from a base64 JSON string.
         *
         * @param {string} sB64 Base64 JSON string.
         * @returns {void}
         */
        handleApplyFilterBarValues: function (sB64) {
            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb || !sB64) return;

            let o = null;
            try { o = JSON.parse(atob(sB64 || btoa("{}"))); } catch (e) { o = null; }
            if (!o) return;

            try {
                if (o.filterData && typeof oSfb.setFilterData === "function") {
                    oSfb.setFilterData(o.filterData, true);
                }
            } catch (e2) { }
        },

        /**
         * Serializes smart table visible columns.
         *
         * @returns {string} Base64 JSON string.
         */
        handleSerializeSmartTableVariant: function () {
            const oSmartTable = this.handleGetSmartTable();
            const oTable = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
            if (!oTable || !oTable.getColumns) return btoa(JSON.stringify([]));

            const aColumnData = [];
            oTable.getColumns().forEach(function (oCol) {
                if (!oCol.getVisible || !oCol.getVisible()) return;

                const sKey = this.handleGetColumnKeyFromP13n(oCol);
                if (sKey) aColumnData.push({ name: sKey });
            }.bind(this));

            return btoa(JSON.stringify(aColumnData));
        },

        /**
         * Serializes smart table state (sorting, grouping, column filters).
         *
         * @returns {string} Base64 JSON string.
         */
        handleSerializeSmartTableValues: function () {
            const oSmartTable = this.handleGetSmartTable();
            const oTable = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
            if (!oTable) return btoa(JSON.stringify({}));

            const oOut = {
                presentationVariant: null,
                sortOrder: [],
                groupBy: [],
                columnFilters: []
            };

            try {
                if (oSmartTable && typeof oSmartTable.getUiState === "function") {
                    const oUi = oSmartTable.getUiState();
                    if (oUi && typeof oUi.getPresentationVariant === "function") {
                        const oPV = oUi.getPresentationVariant();
                        if (oPV && typeof oPV.toJSONObject === "function") {
                            oOut.presentationVariant = oPV.toJSONObject();
                        }
                    }
                }
            } catch (e) { }

            try {
                const oBinding = this.handleGetTableBinding(oTable);
                const aCols = (oTable.getColumns && oTable.getColumns()) || [];

                aCols.forEach(function (oCol) {
                    if (!oCol) return;
                    if (typeof oCol.getSorted === "function" && oCol.getSorted()) {
                        const sKey = this.handleGetColumnKeyFromP13n(oCol);
                        const sOrder = (typeof oCol.getSortOrder === "function") ? oCol.getSortOrder() : "Ascending";
                        if (sKey) {
                            oOut.sortOrder.push({ Property: sKey, Descending: (sOrder === "Descending") });
                        }
                    }
                }.bind(this));

                if (typeof oTable.getGroupBy === "function") {
                    const oGroupCol = oTable.getGroupBy();
                    const sGroupKey = oGroupCol ? this.handleGetColumnKeyFromP13n(oGroupCol) : null;
                    if (sGroupKey) {
                        oOut.groupBy = [sGroupKey];
                    }
                }

                aCols.forEach(function (oCol) {
                    if (!oCol) return;

                    const sKey = this.handleGetColumnKeyFromP13n(oCol);
                    if (!sKey) return;

                    const sVal = (typeof oCol.getFilterValue === "function") ? oCol.getFilterValue() : "";
                    const sOp = (typeof oCol.getFilterOperator === "function") ? oCol.getFilterOperator() : "";

                    if (sVal !== undefined && sVal !== null && (String(sVal).trim() !== "")) {
                        oOut.columnFilters.push({
                            Property: sKey,
                            Operator: sOp || "Contains",
                            Value1: sVal
                        });
                    }
                }.bind(this));

                if (oOut.presentationVariant) {
                    const pv = oOut.presentationVariant;
                    oOut.sortOrder = (pv.SortOrder || pv.sortOrder || oOut.sortOrder || []);
                    oOut.groupBy = (pv.GroupBy || pv.groupby || oOut.groupBy || []);
                } else if (oBinding && oBinding.aSorters && Array.isArray(oBinding.aSorters) && !oOut.sortOrder.length) {
                    oOut.sortOrder = oBinding.aSorters.map(function (s) {
                        return { Property: s && s.sPath, Descending: !!(s && s.bDescending) };
                    }).filter(function (x) { return x && x.Property; });
                }
            } catch (e2) { }

            return btoa(JSON.stringify(oOut));
        },

        /**
         * Applies smart table state (sorting, grouping, column filters).
         *
         * @param {object} oState Table state object.
         * @returns {void}
         */
        handleApplySmartTableValues: function (oState) {
            const oSmartTable = this.handleGetSmartTable();
            const oTable = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
            if (!oTable || !oState) return;

            const oBinding = this.handleGetTableBinding(oTable);
            if (!oBinding || typeof oBinding.sort !== "function") return;

            const aGroup = Array.isArray(oState.groupBy) ? oState.groupBy : [];
            const aSort = Array.isArray(oState.sortOrder) ? oState.sortOrder : [];
            const aColFilters = Array.isArray(oState.columnFilters) ? oState.columnFilters : [];

            try {
                const aSorters = [];

                if (aGroup.length) {
                    aGroup.forEach(function (sProp) {
                        if (!sProp) return;
                        aSorters.push(new Sorter(sProp, false, true));
                    });
                }

                aSort.forEach(function (o) {
                    const sProp = o && (o.Property || o.property);
                    if (!sProp) return;
                    const bDesc = !!(o.Descending || o.descending);
                    aSorters.push(new Sorter(sProp, bDesc));
                });

                oBinding.sort(aSorters);
            } catch (e) { }

            try {
                if (typeof oBinding.filter === "function" && aColFilters.length) {
                    const aFilters = aColFilters.map(function (f) {
                        const sProp = f.Property;
                        const sOp = f.Operator || "Contains";
                        const v1 = f.Value1;
                        const v2 = f.Value2;

                        const op = FilterOperator[sOp] ? FilterOperator[sOp] : FilterOperator.Contains;

                        if (v2 !== undefined && v2 !== null && String(v2) !== "") {
                            return new Filter(sProp, op, v1, v2);
                        }
                        return new Filter(sProp, op, v1);
                    }).filter(Boolean);

                    oBinding.filter(aFilters);
                }
            } catch (e2) { }
        },

        // =====================================================================
        // Table / Columns
        // =====================================================================

        /**
         * Extracts a stable column key from p13n data.
         *
         * @param {sap.ui.table.Column|sap.m.Column} oColumn Column instance.
         * @returns {string|null} Column key, if available.
         */
        handleGetColumnKeyFromP13n: function (oColumn) {
            try {
                const v = oColumn.data("p13nData");
                if (!v) return null;

                const o = (typeof v === "string") ? JSON.parse(v) : v;
                return (o && (o.columnKey || o.leadingProperty)) || null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Returns the list of currently visible column keys.
         *
         * @returns {string[]} Column keys.
         */
        handleGetVisibleColumnKeys: function () {
            const oSmartTable = this.handleGetSmartTable();
            const oTable = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
            if (!oTable || !oTable.getColumns) return [];

            const aKeys = [];
            oTable.getColumns().forEach(function (oCol) {
                if (!oCol.getVisible || !oCol.getVisible()) return;
                const sKey = this.handleGetColumnKeyFromP13n(oCol);
                if (sKey) aKeys.push(sKey);
            }.bind(this));

            return aKeys;
        },

        /**
         * Applies column visibility based on a list of keys.
         *
         * @param {string[]} aKeys Allowed visible column keys.
         * @returns {void}
         */
        handleApplyColumnsByKeys: function (aKeys) {
            const oSmartTable = this.handleGetSmartTable();
            const oTable = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
            if (!oTable || !oTable.getColumns) return;

            const aAllowed = Array.isArray(aKeys) ? aKeys : [];
            oTable.getColumns().forEach(function (oCol) {
                const sKey = this.handleGetColumnKeyFromP13n(oCol);
                if (!sKey) return;
                oCol.setVisible(aAllowed.indexOf(sKey) !== -1);
            }.bind(this));
        },

        /**
         * Returns the table binding for rows/items.
         *
         * @param {sap.ui.core.Control} oTable Table control.
         * @returns {sap.ui.model.Binding|null} Binding instance.
         */
        handleGetTableBinding: function (oTable) {
            if (!oTable || !oTable.getBinding) return null;
            return oTable.getBinding("rows") || oTable.getBinding("items") || null;
        },

        // =====================================================================
        // Pending state between rebinds
        // =====================================================================

        /**
         * Stores pending column keys to be applied after rebind.
         *
         * @param {string[]} aKeys Column keys.
         * @returns {void}
         */
        handleSetPendingColumnKeys: function (aKeys) {
            const oMain = this.handleGetMainModel();
            if (!oMain) return;
            oMain.setProperty("/_pendingColKeys", Array.isArray(aKeys) ? aKeys : []);
        },

        /**
         * Retrieves and clears pending column keys.
         *
         * @returns {string[]} Pending column keys.
         */
        handleConsumePendingColumnKeys: function () {
            const oMain = this.handleGetMainModel();
            if (!oMain) return [];

            const a = oMain.getProperty("/_pendingColKeys") || [];
            oMain.setProperty("/_pendingColKeys", []);
            return a;
        },

        /**
         * Stores pending table state to be applied after rebind.
         *
         * @param {object|null} oState Table state object.
         * @returns {void}
         */
        handleSetPendingTableState: function (oState) {
            const oMain = this.handleGetMainModel();
            if (!oMain) return;
            oMain.setProperty("/_pendingTableState", oState || null);
        },

        /**
         * Retrieves and clears pending table state.
         *
         * @returns {object|null} Pending state.
         */
        handleConsumePendingTableState: function () {
            const oMain = this.handleGetMainModel();
            if (!oMain) return null;

            const o = oMain.getProperty("/_pendingTableState") || null;
            oMain.setProperty("/_pendingTableState", null);
            return o;
        },

        // =====================================================================
        // Generic UI helpers
        // =====================================================================

        /**
         * Clears the SmartFilterBar filters.
         *
         * @returns {void}
         */
        handleClearFilterBar: function () {
            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb) return;

            if (typeof oSfb.clear === "function") oSfb.clear();
            else if (typeof oSfb.fireClear === "function") oSfb.fireClear();
        },

        /**
         * Resets the SmartFilterBar to initial state.
         *
         * @returns {void}
         */
        handleResetFilterBarToInitial: function () {
            const oSfb = this.handleGetSmartFilterBar();
            if (!oSfb) return;

            if (typeof oSfb.reset === "function") {
                oSfb.reset();
                return;
            }

            this.handleClearFilterBar();
        },

        /**
         * Triggers a search and optionally rebinds the SmartTable.
         *
         * @param {boolean} [bRebindTable] Whether to rebind the SmartTable.
         * @returns {void}
         */
        handleSearchTable: function (bRebindTable) {
            const oSfb = this.handleGetSmartFilterBar();
            const oSt = this.handleGetSmartTable();

            if (oSfb && typeof oSfb.search === "function") {
                oSfb.search();
            }

            if (oSt && typeof oSt.rebindTable === "function" && bRebindTable) {
                oSt.rebindTable(true);
            }
        },

        // =====================================================================
        // Fragment loading and accessors
        // =====================================================================

        /**
         * Loads and caches a fragment by prefix.
         *
         * @param {string} sPrefix Fragment prefix/id suffix.
         * @param {string} sName Fragment name.
         * @returns {Promise<sap.ui.core.Control>} Fragment root control promise.
         */
        handleLoadFragment: function (sPrefix, sName) {
            this._mVariantFragments = this._mVariantFragments || {};
            if (this._mVariantFragments[sPrefix]) {
                return this._mVariantFragments[sPrefix];
            }

            const oView = this.getView();
            this._mVariantFragments[sPrefix] = Fragment.load({
                id: oView.getId() + "--" + sPrefix,
                name: sName,
                controller: this
            }).then(function (oRootControl) {
                oView.addDependent(oRootControl);
                return oRootControl;
            });

            return this._mVariantFragments[sPrefix];
        },

        /**
         * Returns the VariantUtil configuration.
         *
         * @returns {object} Configuration object.
         */
        handleGetCfg: function () {
            return this._oVariantCfg;
        },

        /**
         * Returns the variants OData model instance.
         *
         * @returns {sap.ui.model.odata.v2.ODataModel} Variant model.
         */
        handleGetVariantModel: function () {
            return this.getModel(this.handleGetCfg().variantModel);
        },

        /**
         * Returns the main JSON model instance.
         *
         * @returns {sap.ui.model.json.JSONModel} Main model.
         */
        handleGetMainModel: function () {
            return this.getModel(this.handleGetCfg().mainModel);
        },

        /**
         * Returns the SmartFilterBar control.
         *
         * @returns {sap.ui.comp.smartfilterbar.SmartFilterBar} SmartFilterBar.
         */
        handleGetSmartFilterBar: function () {
            return this.byId(this.handleGetCfg().smartFilterBarId);
        },

        /**
         * Returns the SmartTable control.
         *
         * @returns {sap.ui.comp.smarttable.SmartTable} SmartTable.
         */
        handleGetSmartTable: function () {
            return this.byId(this.handleGetCfg().smartTableId);
        },

        /**
         * Returns the variant list popover.
         *
         * @returns {sap.m.Popover} Popover instance.
         */
        handleGetPopover: function () {
            return this.byId(this.handleGetCfg().fragVariantListPrefix + "--Popover");
        },

        /**
         * Returns the variant list control.
         *
         * @returns {sap.m.List} List instance.
         */
        handleGetVariantList: function () {
            return this.byId(this.handleGetCfg().fragVariantListPrefix + "--VariantList");
        },

        /**
         * Returns the manage dialog.
         *
         * @returns {sap.m.Dialog} Dialog instance.
         */
        handleGetManageDialog: function () {
            return this.byId(this.handleGetCfg().fragManagePrefix + "--Dialog");
        },

        /**
         * Returns the manage table.
         *
         * @returns {sap.m.Table} Table instance.
         */
        handleGetManageTable: function () {
            return this.byId(this.handleGetCfg().fragManagePrefix + "--Table");
        },

        /**
         * Returns the save dialog.
         *
         * @returns {sap.m.Dialog} Dialog instance.
         */
        handleGetSaveDialog: function () {
            return this.byId(this.handleGetCfg().fragSavePrefix + "--Dialog");
        },

    });

    return VariantUtil;
});
