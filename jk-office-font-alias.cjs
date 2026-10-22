"use strict";

// Server-side fontconfig aliases for non-standard WPS/Word Arial-style font names.
// This runs only inside the LibreOffice conversion child process.
// Only the four non-standard Arial name variants are mapped to Roboto.\n// Standard Arial, Times New Roman and other font families are not redirected.\n// The customer DOCX, stored original, report templates and system fontconfig
// are not modified.
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG = String.raw`<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="no">/etc/fonts/fonts.conf</include>
  <match target="pattern">
    <test name="family" qual="any" compare="eq"><string>Arial Regular</string></test>
    <edit name="family" mode="assign" binding="strong"><string>Roboto</string></edit>
  </match>
  <match target="pattern">
    <test name="family" qual="any" compare="eq"><string>Arial Bold</string></test>
    <edit name="family" mode="assign" binding="strong"><string>Roboto</string></edit>
    <edit name="weight" mode="assign"><const>bold</const></edit>
  </match>
  <match target="pattern">
    <test name="family" qual="any" compare="eq"><string>Arial Italic</string></test>
    <edit name="family" mode="assign" binding="strong"><string>Roboto</string></edit>
    <edit name="slant" mode="assign"><const>italic</const></edit>
  </match>
  <match target="pattern">
    <test name="family" qual="any" compare="eq"><string>Arial Bold Italic</string></test>
    <edit name="family" mode="assign" binding="strong"><string>Roboto</string></edit>
    <edit name="weight" mode="assign"><const>bold</const></edit>
    <edit name="slant" mode="assign"><const>italic</const></edit>
  </match>
</fontconfig>
`;

function beginOfficeFontAliases({
  env = process.env,
  platform = process.platform,
  systemConfigPath = "/etc/fonts/fonts.conf"
} = {}) {
  if (platform !== "linux" ||
      /^(?:0|false|off)$/i.test(String(env.JK_OFFICE_FONT_ALIAS_ENABLED ?? "")) ||
      env.FONTCONFIG_FILE ||
      !fs.existsSync(systemConfigPath)) {
    return null;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-office-fonts-"));
  const configPath = path.join(directory, "fonts.conf");

  try {
    fs.writeFileSync(configPath, CONFIG, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    env: { ...env, FONTCONFIG_FILE: configPath },
    configPath,
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

module.exports = { beginOfficeFontAliases, CONFIG };
