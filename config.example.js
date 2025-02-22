/**
 * @typedef {Object} config 設定檔
 * @property {String} token Discord機器人Token
 * @property {Boolean} enableApi 是否啟用API伺服器
 * @property {Boolean} enableWeb 是否啟用網頁伺服器
 * @property {Number} apiPort API伺服器監聽端口
 */

/**
 * 黑貓設定文件
 * @return {config} 設定檔
 */
module.exports = function () {
  const config = {
    token: process.env.TOKEN || "TOKEN",
    // 範例: MTdqrd0vGDV1dcF0QPjom6OB.NQxUhj.I4JjFHIympR3mVF3UiUbbD5VVbi
    // 如果要從環境變數使用，請輸入:
    // process.env.<變數名稱>
    prefix: process.env.PREFIX || "PREFIX",
    // 指令前綴
    enableApi: false,
    // 注意：此功能尚未支援
    // 是否要啟用API伺服器
    // 啟用此功能必須要將enableWeb設為true
    // 除非網頁應用程式有在其他伺服器上運行
    enableWeb: false,
    // 注意：此功能尚未支援
    // 是否要啟用網頁伺服器
    apiPort: process.env.PORT || 8080,
    // API伺服器監聽端口
  }






















  // 請勿修改
  let log = require("./src/logger.js");
  let invaild = false;
  if (typeof config.token !== "string") {
    log.error("`token`不是一個字串");
    invaild=true;
  }
  if (typeof config.enableApi !== "boolean") {
    log.error("`enableApi`不是一個布林值(true/false)");
    invaild=true;
  }
  if (typeof config.enableWeb !== "boolean") {
    log.error("`enableWeb`不是一個布林值(true/false)");
    invaild=true;
  }
  if (typeof config.apiPort !== "number") {
    log.error("`apiPort`不是一個數字");
    invaild=true;
  }

  if (invaild) {
    log.error("設定出現錯誤，程式正在自動關閉");
    process.exit(1);
  } else {
    log.info("成功讀取設定");
    return config;
  }
}