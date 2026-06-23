#!/usr/bin/env node
/* eslint-env node */

/**
 * bsg.mjs ― Legado 书源生成工具箱 CLI
 *
 * 用法:
 *   node "<skill-dir>/scripts/bsg.mjs" init <url> [--fast]
 *   node "<skill-dir>/scripts/bsg.mjs" toolbox
 *   node "<skill-dir>/scripts/bsg.mjs" run --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" status --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" advance --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" check --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" record-assessment --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" set-login-features --run <dir> [--flags <json>]
 *   node "<skill-dir>/scripts/bsg.mjs" record-validation --run <dir> --status <status>
 *   node "<skill-dir>/scripts/bsg.mjs" deliver --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" android --run <dir> [--dump-cookie <file>]
 *   node "<skill-dir>/scripts/bsg.mjs" debug-bundle [--run <dir>] [--cwd <work-dir>] [--transcript <file>] [--claude-session <id>]
 *   node "<skill-dir>/scripts/bsg.mjs" source inspect|set --run <dir>
 *   node "<skill-dir>/scripts/bsg.mjs" login [--run <dir> | --url <login-url>] [--keep-cookies]
 *   node "<skill-dir>/scripts/bsg.mjs" validator-start [--background]
 *   node "<skill-dir>/scripts/bsg.mjs" validator-stop
 */

import {
  cmdInit,
  cmdToolbox,
  cmdRun,
  cmdStatus,
  cmdAdvance,
  cmdCheck,
  cmdRecordAssessment,
  cmdSetLoginFeatures,
  cmdResolveUserAction,
  cmdAndroidStatus,
  cmdAndroid,
  cmdRecordValidation,
  cmdDeliver,
  cmdDebugBundle,
  cmdSource,
  cmdLogin,
  cmdValidate,
  cmdValidatorStart,
  cmdValidatorStop,
} from "./lib/commands.mjs";
import { fail } from "./lib/state.mjs";

function printUsage() {
  console.error(
    [
      "用法:",
      "  node \"<skill-dir>/scripts/bsg.mjs\" init <site-url> [--fast]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" toolbox",
      "  node \"<skill-dir>/scripts/bsg.mjs\" run --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" status --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" advance --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" check --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" record-assessment --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" set-login-features --run {dir} [--flags <json>]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" resolve-user-action --run {dir} --action <action>",
      "  node \"<skill-dir>/scripts/bsg.mjs\" android --run {dir} [--dump-cookie <file>]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" record-validation --run {dir} --status <status>",
      "  node \"<skill-dir>/scripts/bsg.mjs\" deliver --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" debug-bundle [--run {dir}] [--cwd {work-dir}] [--transcript {file}] [--claude-session {id}]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" source inspect|set --run {dir}",
      "  node \"<skill-dir>/scripts/bsg.mjs\" android-status",
      "  node \"<skill-dir>/scripts/bsg.mjs\" login [--run <dir> | --url <login-url>] [--keep-cookies]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" validate --run {dir} [--keyword <kw>] [--mode http|browser|android]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" validator-start [--background]",
      "  node \"<skill-dir>/scripts/bsg.mjs\" validator-stop",
    ].join("\n")
  );
}

async function main(argv) {
  if (argv.length < 1) {
    printUsage();
    return 1;
  }

  const command = argv[0];
  const args = argv.slice(1);
  let result;

  switch (command) {
    case "init":
      result = cmdInit(args);
      break;
    case "toolbox":
      result = cmdToolbox();
      break;
    case "run":
      result = cmdRun(args);
      break;
    case "status":
      result = cmdStatus(args);
      break;
    case "advance":
      result = cmdAdvance(args);
      break;
    case "check":
      result = cmdCheck(args);
      break;
    case "record-assessment":
      result = cmdRecordAssessment(args);
      break;
    case "set-login-features":
      result = cmdSetLoginFeatures(args);
      break;
    case "resolve-user-action":
      result = cmdResolveUserAction(args);
      break;
    case "android-status":
      result = cmdAndroidStatus();
      break;
    case "android":
      result = cmdAndroid(args);
      break;
    case "record-validation":
      result = cmdRecordValidation(args);
      break;
    case "deliver":
      result = cmdDeliver(args);
      break;
    case "debug-bundle":
      result = cmdDebugBundle(args);
      break;
    case "source":
      result = cmdSource(args);
      break;
    case "login":
      result = cmdLogin(args);
      break;
    case "validate":
      result = cmdValidate(args);
      break;
    case "validator-start":
      result = await cmdValidatorStart(args);
      break;
    case "validator-stop":
      result = await cmdValidatorStop();
      break;
    default:
      result = fail(
        `未知命令: ${command}。可用: init, toolbox, run, status, advance, check, record-assessment, set-login-features, resolve-user-action, android, android-status, record-validation, deliver, debug-bundle, source, login, validate, validator-start, validator-stop`
      );
  }

  console.log(JSON.stringify(result, null, 2));
  return result.ok && result.status !== "blocked" ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
