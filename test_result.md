#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## M3b (S1, S2, F4, F5) — main agent
- Backend: 98/98 pytest pass serially (`pytest -n 0`); new file tests/test_m3b_safeguards.py (14 tests). With -n 2, TestAccountThrottle can collide with TestLogin (shared main-user lockout counters) — pre-existing parallelism artefact.
- Frontend to test: Earnings tab (week/month/year, prev/next, totals, by duty, export button), ExportSheet (CSV/PDF -> privacy warning -> share), Recently Deleted screen (/recently-deleted, from Account), delete moves shift to Recently Deleted + restore with payments, provisional banner/pill + payment clash panel (Keep this), History summary totals match Earnings/Home.

## M3c — main agent
- Backend 122/122 serial (`pytest -n 0`): new tests/test_m3c.py (24). Security audit run; SEC-001/002/005 fixed, SEC-003/004 documented.
- Frontend to test: payment clash panel (payment-clash-panel-edit / -decision / -none pending), Keep this -> payment-clash-confirm -> payment-clash-confirm-button; payments-history-note; Account rows account-privacy-row / account-terms-row; public pages /api/public/privacy, /terms, /delete-account (2-step form, explicit checkbox).

## M4 Stage A — main agent
- Backend 145/145 serial (122 + 23 in tests/test_m4_billing.py, mocked Google Play API via db.mock_play, BILLING_MODE=mock).
- Note: backend tests sync the main user without X-Device-Id, which sets users.sync_device="unknown"; unset it before UI testing ($unset sync_device) or the web app will show the "Another phone is your sync phone" banner.

## Phases A+B — main agent
- Backend 160/160 (145 prior + 15 tests/test_phase_ab.py; m4 test & m3c privacy test updated for approved Free/branding changes).
- Free: 3 active/future shifts (server returns status "limit"; app keeps record `_held`), 7-day visible history, CSV/PDF Pro-only, 1 custom template (PATCH /me shift_templates, 403 pro_required_templates), free JSON GET /api/me/data-download (1 per 7 days, 429 with support text). Founding offer: founding_eligible in /billing/entitlement.
- Reset main user before UI tests: $unset sync_device, last_data_download_at.

## Phase C — main agent
- Backend 178/178 serial (167 + 11 tests/test_referrals.py). Admins via ADMIN_EMAILS (delivered+t1@resend.dev is admin).
- Frontend to test: Account rows account-referrals-row / account-admin-referrals-row; /referrals (referral-code, referral-share-button, referral-apply-input/button); /admin-referrals (admin-filter-*, admin-approve-<id>, admin-cancel-<id>, admin-member-email/find/ambassador/cap/cap-save); register-referral-input; upgrade page shows £3.99/£34.99 (founding £2.99/£24.99).

## Admin dashboard — main agent
- New /admin screen (account-admin-row, admin-stat-*, admin-programme-<key>-switch, admin-open-referrals, admin-activity-<i>). Reset delivered+t1 bonus_pro_until/plan after referral UI tests.

## Phase D — main agent
- New: referral-totals / referral-month-* / referral-all-* / referral-rewards-left; admin Held filter (admin-filter-held), admin-warning-<id>; profile-tax-input; payments-after-tax; earnings-after-tax. Backend tests/test_phase_d.py (5). Running pytest while logged in on web sets sync_device on main user → unset before pytest.

## Shift form fresh-open fix + refresh/clear
- shift-form remounts per params (+ n nonce from all callers); header Clear (add/duplicate → blank) / Undo changes (edit). HeaderActions refresh button (header-refresh-button) on Home/Shifts/Earnings.

## Step A + share/download — main agent
- Package uk.dutyconnect.app (app.json android+ios, versionCode 1; backend ANDROID_PACKAGE). Account footer has full disclaimer.
- ShareAppSheet (share-app-sheet, share-app-aptoide, share-app-direct, share-app-cancel) from Home quick action home-quick-share, Account row account-share-row, Refer a friend share button (includes code).
- Public: /api/public/download/android (302 to APK_URL if https else download page), /api/public/app-version, download page shows direct APK button or "coming soon" (download-apk-soon).
- Update check (aptoide store only): UpdateBanner on Home (update-banner) when APP_LATEST_VERSION > app version; RequiredUpdateGate when below APP_MIN_VERSION.
