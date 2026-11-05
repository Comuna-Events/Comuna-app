package com.wearecomuna.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Comuna's own plugin (opening notification settings) has to be registered before the app starts
        registerPlugin(ComunaSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
