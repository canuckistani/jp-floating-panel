# Floating Panel

A simple module that allows you to launch a floating panel from a toolbar button. Based on the Pixel Perfect re-write by @honza.

Example:

    let { ToggleButton } = require("sdk/ui/button/toggle");
    let { FoatingPanel } = require('floating-panel');
    let panel = FloatingPanel({
        title: "Example floating panel!",
        contentURL: self.data.url('index.html'),
        contentScriptFile: self.data.url('index.js')
    });

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