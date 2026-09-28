/* ═══════════════════════════════════════════════════════════
   HZS 云端配置（腾讯云开发 CloudBase · PostgreSQL 模式）
   填写说明：
   - ENV_ID：云开发环境 ID，形如 hzs-assets-3gxxxxxxxxxx
   - PUBLISHABLE_KEY：环境的 Publishable Key（前端公开密钥，
     可放在前端；数据安全由数据库 GRANT + RLS 策略保证。
     API Key / service_role 是管理员密钥，切勿填写或外泄）
   ═══════════════════════════════════════════════════════════ */
window.HZS_CONFIG = {
  ENV_ID: 'hzs-d8gafqphy1c37ebab',
  REGION: 'ap-shanghai',
  PUBLISHABLE_KEY: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjYxZWZkNWE2LTlmNTUtNDhlMC1iOGFhLTU5NDQxMTE1OTczNCJ9.eyJpc3MiOiJodHRwczovL2h6cy1kOGdhZnFwaHkxYzM3ZWJhYi5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9ueW1vdXMiLCJhdWQiOiJoeXMtZDhnYWZxcGh5MWMzN2ViYWIiLCJleHAiOjQwOTM5MjcxODMsImlhdCI6MTc5MDI0Mzk4Mywibm9uY2UiOiI4dDUwZXdZZlMwR3BDOFdYcDBuZzRnIiwiYXRfaGFzaCI6Ijh0NTBld1lmUzBHcEM4V1hwMG5nNGciLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoiaHpzLWQ4Z2FmcXBoeTFjMzdlYmFiIiwibWV0YSI6eyJwbGF0Zm9ybSI6IlB1Ymxpc2hhYmxlS2V5In0sInJvbGUiOiJhbm9uIiwpc19hbm9ueW1vdXMiOnRydWUsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImFub255bW91cyIsInByb3ZpZGVycyI6WyJhbm9ueW1vdXMiXX0sInVzZXJfbWV0YWRhdGEiOnsibmFtZSI6IkFub255bW91cyJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.wQ-QHjKBPtFDd_TrlD2ID1PNpA8axKoItyFQMgGyl8-Lxm6R553cslX39zHE4HtRr0TN4y2aHsHO_vcBG2YRuoNATOO2a7d5xJ2Jw4E4yJZqd6o088-xfSSOSP_2moUgMHiRJfHXgnfPGqOlfL15K3P8cFIPsfV5Iwzhic5k016IJ0fvmw4ijNQ-Bf5vyhHbGBLQnRnbkVd6lUTzncL9dswG040fhYSReRb9PRPbOFRKcTaCTU-JHL8g6zeno-kLrqeHKQ6qcFfp0fBOteD8MsKsUZun5Gd1Rkjrf8M6ZQ4OtLwu2xCpfopYgPjbwCGOiBtyajEpIPUkUMbtOQ4J1g',
};
