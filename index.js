/* adapted from https://raw.githubusercontent.com/firebug/pixel-perfect/master/lib/pixel-perfect-popup.js */

"use strict";

const self = require("sdk/self");
const options = require("@loader/options");
const { Content } = require('./content');
const { Cu, Ci, Cc } = require("chrome");
const { Class } = require("sdk/core/heritage");
const { getMostRecentBrowserWindow } = require("sdk/window/utils");
const { on, off, emit } = require("sdk/event/core");
const DomEvents = require("sdk/dom/events");
const { openTab } = require("sdk/tabs/utils");
const { defer, resolve } = require("sdk/core/promise");

// DevTools
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { makeInfallible } = devtools["require"]("devtools/toolkit/DevToolsUtils.js");

// Platform Services
const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

// Constants
// const STYLESHEET = "chrome://pixelperfect/skin/ua.css";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const FloatingPanel = Class(
/** @lends FloatingPanel */
{
  // Initialization

  initialize: function(options) {
    this.options = options;
    this.onPanelReady = this.onPanelReady.bind(this);
    this.onMessage = this.onMessage.bind(this);

    // Panel event handlers
    this.onPopupHidden = this.onPopupHidden.bind(this);
    this.onPopupShown = this.onPopupShown.bind(this);
  },

  destroy: function() {
    if (this.registrar) {
      this.registrar.unregister();
    }
  },

  // Visibility

  toggle: function() {
    if (this.isOpen()) {
      this.hide();
    } else {
      this.show();
    }
  },

  isOpen: function() {
    return (this.panel && this.panel.state == "open");
  },

  show: function() {
    let browser = getMostRecentBrowserWindow();
    let doc = browser.document;
    // Attach backend actors.
    // this.attach();

    // Create panel with content iframe that implements the entire UI.
    // The iframe uses type='content' and so, it's content has limited
    // (content) privileges. The communication with the content is done
    // through message managers.
    if (!this.panel) {
      this.createPanel();
    }

    if (this.position) {
      this.panel.openPopupAtScreen(this.position.x, this.position.y);
    } else {
      this.panel.openPopupAtScreen(400, 400);
    }
  },

  hide: function() {
    if (this.panel) {
      this.panel.hidePopup();
    }
  },

  // Popup Panel Content

  createPanel: function() {
    let browser = getMostRecentBrowserWindow();
    let doc = browser.document;

    this.panel = doc.createElementNS(XUL_NS, "panel");
    this.panel.setAttribute("id", "pixel-perfect-panel");
    this.panel.setAttribute("noautohide", "true");
    this.panel.setAttribute("titlebar", "normal");
    this.panel.setAttribute("noautofocus", "true");
    this.panel.setAttribute("label", options.title);
    this.panel.setAttribute("close", "true");
    this.panel.style.border = "0";

    this.panelFrame = doc.createElementNS(XUL_NS, "iframe");
    this.panelFrame.setAttribute("type", "content");
    this.panelFrame.setAttribute("border", "0");
    this.panelFrame.setAttribute("flex", "1");

    // xxxHonza: unregister listeners?
    DomEvents.on(this.panel, "popuphidden", this.onPopupHidden);
    DomEvents.on(this.panel, "popupshown", this.onPopupShown);

    this.panelFrame.setAttribute("src", self.data.url(this.options.contentURL));
    this.panel.appendChild(this.panelFrame);

    let container = doc.getElementById("mainPopupSet");
    container.appendChild(this.panel);

    // Load content script and handle messages sent from it.
    let { messageManager } = this.panelFrame.frameLoader;
    if (messageManager) {
      let url = self.data.url(this.options.contentScriptFile);
      messageManager.loadFrameScript(url, false);
      messageManager.addMessageListener("message", this.onMessage);
      messageManager.addMessageListener("sdk/event/ready", this.onPanelReady);
    }

    return this.panel;
  },

  onPanelReady: makeInfallible(function() {
    let win = this.panelFrame.contentWindow;
    let __console = {
      log: (message) => {
        console.log("content>", message);
      }
    }

    Content.exportIntoContentScope(win, __console, "__console");
  }),

  // Popup Panel Event Handlers

  onPopupShown: function(event) {
    emit(this, "popupshown");
  },

  onPopupHidden: function(event) {
    this.position = {
      x: this.panel.boxObject.screenX,
      y: this.panel.boxObject.screenY
    };

    // Detach from the backend
    this.detach();

    emit(this, "popuphidden");
  },

  // Communication: content <-> chrome

  onMessage: function(msg) {
    let event = msg.data;

    switch (event.type) {
    case "panel-ready":
      // Just send back initial 'refresh' message.
      break;
    case "add":
    case "remove":
    case "modify":
      // Execute specified method.
      this.store[event.type].apply(this.store, event.args);
      break;
    case "open-homepage":
      this.openNewTab(options.manifest.homepage);
      break;
    }

    let message = {
      version: self.version,
      layers: this.store.layers
    };

    // Make sure the panel content is refreshed.
    this.postContentMessage("refresh", JSON.stringify(message));
  },

  openNewTab: function(url) {
    let browser = getMostRecentBrowserWindow();
    openTab(browser, url);
  },

  postContentMessage: function(id, data) {
    let { messageManager } = this.panelFrame.frameLoader;
    messageManager.sendAsyncMessage("pixelperfect/event/message", {
      type: id,
      bubbles: false,
      cancelable: false,
      data: data,
      origin: this.url,
    });
  },

  detach: function() {
    if (!this.front) {
      return resolve();
    }

    off(this.front, "dragstart", this.onDragStart);
    off(this.front, "drag", this.onDrag);
    off(this.front, "dragend", this.onDragEnd);

    let deferred = defer();
    this.front.detach().then(response => {
      deferred.resolve(response);
    });

    this.front = null;

    return deferred.promise;
  }
});

// Helpers

function getResource(aURL) {
  try {
    let channel = ioService.newChannel(aURL, null, null);
    let input = channel.open();
    return readFromStream(input);
  }
  catch (e) {
  }
}

function readFromStream(stream, charset) {
  let sis = Cc["@mozilla.org/scriptableinputstream;1"].
    createInstance(Ci.nsIScriptableInputStream);
  sis.init(stream);

  let segments = [];
  for (let count = stream.available(); count; count = stream.available()) {
    segments.push(sis.readBytes(count));
  }

  sis.close();

  return segments.join("");
};

// Exports from this module
exports.FloatingPanel = FloatingPanel;
exports.main = () => {
  let panel = FloatingPanel({
    title: "Example floating panel!",
    contentURL: self.data.url('index.html'),
    contentScriptFile: self.data.url('index.js')
  });

  let { ToggleButton } = require("sdk/ui/button/toggle");

  let button = ToggleButton({
    id: "my-button-id",
    label: "Button Label",
    icon: {
      "16": "chrome://mozapps/skin/extensions/extensionGeneric.png",
      "32": "chrome://mozapps/skin/extensions/extensionGeneric.png"
    },
    onClick: function(state) {
      console.log("button '" + state.label + "' was clicked");
      panel.toggle();
    }
  });

};

