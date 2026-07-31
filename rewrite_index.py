import re

with open('frontend/index.html', 'r') as f:
    content = f.read()

# We will replace everything from <section id="dashboard" class="tabPanel dashboard-layout">
# down to the end of <section id="settings" ...> and the avatar logic.

start_marker = '<section id="dashboard" class="tabPanel dashboard-layout">'
end_marker = '  <div id="interviewModal"'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers!")
    exit(1)

new_layout = """  <div class="app-container">
      
      <!-- Left Drawer: History -->
      <aside id="leftDrawer" class="drawer hidden-drawer glass panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
           <h2 data-i18n="full_history" style="margin: 0;"><i data-lucide="history" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"></i> History</h2>
           <button id="closeLeftDrawerBtn" style="background: transparent; border: none; cursor: pointer; color: var(--muted); padding: 8px;"><i data-lucide="x"></i></button>
        </div>
        <aside class="glass panel" style="margin-bottom: 16px; padding: 16px;">
          <h3 data-i18n="sessions" style="margin:0 0 12px 0; font-size: 14px;"><i data-lucide="clock" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 6px;"></i> Recent Active</h3>
          <div id="sessions" class="stack"></div>
        </aside>
        <p class="muted" data-i18n="history_desc" style="font-size: 12px;">Browse all past deliberations.</p>
        <div id="historyList" class="stack" style="margin-top: 12px;"></div>
      </aside>

      <!-- Main Stage -->
      <section class="main-stage">
        
        <!-- Massive Cinematic Avatar -->
        <div id="avatarStage" class="avatar-cinematic-container">
           <video id="avatarVideo" loop muted playsinline src="https://res.cloudinary.com/dnxsyymiq/video/upload/v1780135364/hailuo-2_3_Create_a_seamless_10-second_looping_video_of_a_professional_businesswoman_speaki-0_jjklzx.mp4"></video>
           <div id="avatarPlayOverlay">
             <i data-lucide="play" style="width: 48px; height: 48px;"></i>
             <span>Click to Begin Interaction</span>
           </div>
        </div>
        
        <!-- Chat Interface -->
        <div class="chat-interface">
          
          <div id="welcomer" class="chat-feed-scroll" style="align-items: center; justify-content: center; text-align: center;">
             <h2 style="font-size: 32px; font-weight: 700; margin-bottom: 8px; color: var(--accent);">Convene Your AI Council</h2>
             <p class="muted" style="font-size: 16px; max-width: 500px; margin-bottom: 32px;">Input your idea or question below. Our multi-LLM council will stress-test it and orchestrate an execution plan.</p>
             
             <!-- Unified settings inside welcomer -->
             <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 24px;">
                <select id="mainMode" style="width: auto; padding: 8px 16px; border-radius: 20px; background: rgba(255,255,255,0.05); cursor: pointer; border: 1px solid var(--border);">
                  <option value="standard">Standard Mode</option>
                  <option value="fast">Fast Mode</option>
                  <option value="deep">Deep Mode</option>
                </select>
                <select id="mainRounds" style="width: auto; padding: 8px 16px; border-radius: 20px; background: rgba(255,255,255,0.05); cursor: pointer; border: 1px solid var(--border);">
                  <option value="1">1 Round</option>
                  <option value="2">2 Rounds</option>
                  <option value="3">3 Rounds</option>
                  <option value="4" selected>4 Rounds</option>
                  <option value="5">5 Rounds</option>
                </select>
                <label style="display: flex; align-items: center; gap: 6px; font-weight: normal; cursor: pointer; padding: 8px 16px; border-radius: 20px; background: rgba(255,255,255,0.05); border: 1px solid var(--border);"><input id="mainSuperbrain" type="checkbox" checked style="width: 14px; height: 14px;" /> Superbrain Pipeline</label>
             </div>
          </div>
          
          <div id="chatFeed" class="chat-feed-scroll hidden">
            <div class="sectionHead" style="flex-shrink: 0; padding: 0 0 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px;">
              <h2 data-i18n="live_council" style="margin:0;"><i data-lucide="activity" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px; color: var(--accent);"></i> Live Council</h2>
              <a id="transcript" class="button disabled" data-i18n="transcript" style="padding: 6px 12px; font-size: 12px;"><i data-lucide="file-text" style="width:14px; height:14px;"></i> Transcript</a>
            </div>
            
            <div id="pipelineStatus" class="hidden" style="margin-bottom: 16px; padding: 12px; background: rgba(37, 99, 235, 0.1); border-left: 4px solid #2563eb; border-radius: 8px; flex-shrink: 0;">
              <strong>Pipeline:</strong> <span id="pipelineStage">Starting...</span>
            </div>
            
            <div id="verdict" style="flex-shrink: 0;"></div>
            
            <div class="metrics" style="flex-shrink: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
              <div style="padding: 10px; border-radius: 12px; text-align: center; background: rgba(0,0,0,0.02); border: 1px solid var(--border);"><small style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Status</small><br/><strong id="status" style="font-size: 16px;">Idle</strong></div>
              <div style="padding: 10px; border-radius: 12px; text-align: center; background: rgba(0,0,0,0.02); border: 1px solid var(--border);"><small style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Round</small><br/><strong id="round" style="font-size: 16px;">-</strong></div>
              <div style="padding: 10px; border-radius: 12px; text-align: center; background: rgba(0,0,0,0.02); border: 1px solid var(--border);"><small style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Consensus</small><br/><strong id="consensus" style="font-size: 16px;">-</strong></div>
              <div style="padding: 10px; border-radius: 12px; text-align: center; background: rgba(0,0,0,0.02); border: 1px solid var(--border);"><small style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Internal</small><br/><strong id="internal" style="font-size: 16px;">Compact</strong></div>
            </div>
            
            <div id="loader" class="loader hidden" style="flex-shrink: 0;">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span> <span>Thinking...</span>
            </div>
            
            <div id="messages" class="messages" style="flex: 1;"></div>
          </div>
          
          <!-- Huge Composer Input -->
          <div class="huge-composer">
             <button id="mainTopicFileBtn" type="button" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 50%; width: 48px; height: 48px; color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;"><i data-lucide="paperclip" style="width: 20px; height: 20px;"></i></button>
             <input type="file" id="mainTopicFileInput" style="display: none;" />
             <textarea id="mainTopicInput" placeholder="What decision requires maximum scrutiny?"></textarea>
             <!-- In welcomer state this acts as 'Convene', in chat state it acts as 'Reply' -->
             <button id="mainConveneBtn" class="huge-mic-btn" title="Convene / Send">
                <i data-lucide="mic"></i>
             </button>
          </div>
          
        </div>
      </section>

      <!-- Right Drawer: Settings -->
      <aside id="rightDrawer" class="drawer hidden-drawer glass panel">
         <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
           <h2 style="margin: 0;"><i data-lucide="settings" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"></i> Settings</h2>
           <button id="closeRightDrawerBtn" style="background: transparent; border: none; cursor: pointer; color: var(--muted); padding: 8px;"><i data-lucide="x"></i></button>
         </div>
         
         <div id="mobileBridgeCard" class="glass panel" style="padding: 16px; text-align: center; display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px;">
            <h2 style="margin: 0; font-size: 16px;"><i data-lucide="smartphone" style="vertical-align: middle; margin-right: 6px; width: 18px; height: 18px; color: var(--accent);"></i> Mobile Upload</h2>
            <p class="muted" style="font-size: 11px; margin: 0;">Scan to beam photos, audio, or notes from your phone.</p>
            <img id="mobileQr" style="width: 130px; height: 130px; margin: 4px auto; background: white; padding: 6px; border-radius: 8px; display: block;" />
            <a id="mobileLink" target="_blank" style="font-size: 11px; color: var(--accent); font-weight: 500; text-decoration: none;">Open Portal</a>
         </div>
         
         <form id="settingsForm" class="stack" autocomplete="off">
            <h3 style="margin: 16px 0 8px 0; color: var(--primary); font-size: 14px;">AnythingLLM Preferences</h3>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Base URL</span><input id="settingUrl" name="anythingllm_base_url" value="http://localhost:3001/api/v1" style="padding: 8px;"/></label>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>API Key</span><input id="settingKey" name="anythingllm_api_key" placeholder="Optional" style="padding: 8px;"/></label>
            
            <h3 style="margin: 16px 0 8px 0; color: var(--primary); font-size: 14px;">SiliconFlow Preferences</h3>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>API Key</span><input id="settingSiliconKey" name="siliconflow_api_key" placeholder="Optional" style="padding: 8px;"/></label>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Model Name</span><input id="settingSiliconModel" name="siliconflow_model" value="Qwen/Qwen2.5-72B-Instruct" style="padding: 8px;"/></label>

            <h3 style="margin: 16px 0 8px 0; color: var(--accent); font-size: 14px;">Database Preferences</h3>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Type</span><select id="settingDbType" name="db_type" style="padding: 8px;"><option value="sqlite">SQLite</option><option value="postgres">PostgreSQL</option></select></label>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>URL</span><input id="settingDbUrl" name="db_url" placeholder="Optional" style="padding: 8px;"/></label>
            
            <h3 style="margin: 16px 0 8px 0; color: var(--accent); font-size: 14px;">Custom Presenter Video</h3>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Looping .mp4</span><input id="settingAvatarVideo" type="file" accept="video/mp4" style="padding: 8px;"/></label>

            <h3 style="margin: 16px 0 8px 0; color: var(--accent); font-size: 14px;">Engine Tuning</h3>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Kelly Circuit Breaker %</span><input id="settingKelly" type="number" value="5" style="padding: 8px;"/></label>
            <label style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;"><span>Entropy Threshold</span><input id="settingEntropy" type="number" value="30" style="padding: 8px;"/></label>

            <button class="primary" type="submit" style="margin-top: 16px; width: 100%; justify-content: center;"><i data-lucide="save"></i> Save Settings</button>
         </form>
         
         <hr style="border-color: var(--border); margin: 24px 0;" />
         <h2 style="font-size: 16px;"><i data-lucide="users" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 6px;"></i> Static Councils</h2>
         <div id="councilList" class="stack" style="margin-bottom: 16px;"></div>
         <button id="importCouncil" class="button" style="width: 100%; justify-content: center;"><i data-lucide="download"></i> Import Current</button>
         
         <!-- Hidden elements to preserve JS bindings that we removed from direct view to save space in the new UI -->
         <div class="hidden">
           <form id="sessionForm">
             <textarea id="topic"></textarea><select id="mode"></select><select id="rounds"></select><select id="councilSelect"></select>
             <input id="compact" type="checkbox" /><input id="web" type="checkbox" /><input id="rag" type="checkbox" />
           </form>
           <form id="councilForm"><input id="councilName" /><input id="councilDescription" /><input id="vetoRoles" /><textarea id="modelOverrides"></textarea><textarea id="manifest"></textarea><button data-i18n="save"></button></form>
           <input id="mainChatInput" /><button id="mainSendBtn"></button>
           <textarea id="settingPromptInterviewer"></textarea><textarea id="settingPromptDeliberation"></textarea><textarea id="settingPromptVerdict"></textarea>
         </div>
      </aside>

    </div>
"""

new_content = content[:start_idx] + new_layout + content[end_idx:]

with open('frontend/index.html', 'w') as f:
    f.write(new_content)

print("Rewrote index.html successfully.")
