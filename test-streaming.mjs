import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--disable-features=IsolateOrigins,site-per-process',
    ]
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));
  
  console.log('=== STEP 1: Navigate to landing page ===');
  try {
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    console.log('SUCCESS: Page title:', title);
    console.log('URL:', page.url());
    await page.screenshot({ path: '/tmp/landing-page.png', fullPage: false });
    console.log('Screenshot saved to /tmp/landing-page.png');
  } catch (e) {
    console.log('FAILED to navigate:', e.message.split('\n')[0]);
    // Try 127.0.0.1
    try {
      await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle', timeout: 30000 });
      const title = await page.title();
      console.log('SUCCESS with 127.0.0.1: Page title:', title);
    } catch (e2) {
      console.log('FAILED with 127.0.0.1 too:', e2.message.split('\n')[0]);
      // Try the eth0 IP
      try {
        await page.goto('http://21.0.5.34:3000/', { waitUntil: 'networkidle', timeout: 15000 });
        const title = await page.title();
        console.log('SUCCESS with 21.0.5.34: Page title:', title);
      } catch (e3) {
        console.log('FAILED with 21.0.5.34 too:', e3.message.split('\n')[0]);
        console.log('Cannot reach the server from browser. Aborting.');
        await browser.close();
        process.exit(1);
      }
    }
  }
  
  // Determine the base URL that works
  const currentUrl = page.url();
  const baseUrl = currentUrl.replace(/\/$/, '');
  console.log('Working base URL:', baseUrl);
  
  console.log('\n=== STEP 2: Check for playground section ===');
  const playgroundVisible = await page.locator('text=Live Playground').isVisible().catch(() => false);
  console.log('Live Playground visible:', playgroundVisible);
  
  const streamingBadge = await page.locator('text=streaming').first().isVisible().catch(() => false);
  console.log('Streaming badge visible:', streamingBadge);
  
  const textarea = page.locator('textarea').first();
  const textareaVisible = await textarea.isVisible().catch(() => false);
  console.log('Textarea visible:', textareaVisible);
  
  const sendBtn = page.locator('button[aria-label="Send"]').first();
  const sendBtnVisible = await sendBtn.isVisible().catch(() => false);
  console.log('Send button visible:', sendBtnVisible);
  
  console.log('\n=== STEP 3: Send a test message ===');
  await textarea.click();
  await textarea.fill('Say hello');
  console.log('Typed "Say hello"');
  await sendBtn.click();
  console.log('Clicked Send');
  
  console.log('\n=== STEP 4: Watch for streaming response ===');
  const startTime = Date.now();
  let prevContent = '';
  let streamingDetected = false;
  let contentSnapshots = [];
  let finalContent = '';
  
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    
    const latestContent = await page.evaluate(() => {
      // Find all message bubbles in the chat area
      const chatArea = document.querySelector('[class*="overflow-y-auto"]') || document.querySelector('[class*="min-h-[420px]"]');
      if (!chatArea) return '';
      
      // Get the last assistant message
      const allDivs = chatArea.querySelectorAll('div');
      let assistantContent = '';
      for (const div of allDivs) {
        const cls = div.className || '';
        if (cls.includes('rounded-bl-sm') || (cls.includes('rounded-2xl') && cls.includes('bg-muted'))) {
          const text = div.textContent?.trim() || '';
          if (text.length > 0 && text !== 'Say hello' && !text.includes('empty response')) {
            assistantContent = text;
          }
        }
      }
      return assistantContent;
    }).catch(() => '');
    
    const elapsed = Date.now() - startTime;
    
    if (latestContent && latestContent !== prevContent) {
      const delta = latestContent.length - prevContent.length;
      console.log(`[${elapsed}ms] Response length: ${latestContent.length} (delta: +${delta})`);
      if (delta > 0 && delta < 100) {
        streamingDetected = true;
      }
      prevContent = latestContent;
      finalContent = latestContent;
      contentSnapshots.push({ elapsed, length: latestContent.length, delta });
    }
    
    // Check if done (stop button disappears)
    const stopBtn = page.locator('button[aria-label="Stop"]');
    const isLoading = await stopBtn.isVisible().catch(() => false);
    if (!isLoading && finalContent.length > 10) {
      console.log(`[${elapsed}ms] Response complete!`);
      await page.screenshot({ path: '/tmp/streaming-final.png' });
      break;
    }
  }
  
  console.log('\nStreaming detected:', streamingDetected);
  console.log('Final response length:', finalContent.length);
  console.log('Content growth over time:', JSON.stringify(contentSnapshots.slice(0, 15)));
  if (finalContent) {
    console.log('Response preview:', finalContent.substring(0, 200));
  }
  
  // Test /chat page
  console.log('\n=== STEP 5: Navigate to /chat page ===');
  await page.goto(`${baseUrl}/chat`, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('URL:', page.url());
  await page.screenshot({ path: '/tmp/chat-page.png' });
  
  const chatTitle = await page.locator('text=AI Inference Playground').isVisible().catch(() => false);
  console.log('AI Inference Playground visible:', chatTitle);
  
  console.log('\n=== STEP 6: Send test message on /chat ===');
  const chatTextarea = page.locator('textarea').first();
  await chatTextarea.waitFor({ state: 'visible', timeout: 10000 });
  await chatTextarea.click();
  await chatTextarea.fill('What is 2+2?');
  console.log('Typed "What is 2+2?"');
  
  // Find the send button on the chat page
  await page.waitForTimeout(500);
  const chatSendBtn = page.locator('button[aria-label="Send"]').first();
  if (await chatSendBtn.isVisible().catch(() => false)) {
    await chatSendBtn.click();
    console.log('Clicked Send button');
  } else {
    // Try the purple gradient send button
    const purpleBtn = page.locator('button:has(svg)').last();
    await purpleBtn.click();
    console.log('Clicked purple Send button');
  }
  
  console.log('\n=== STEP 7: Watch streaming on /chat ===');
  const chatStartTime = Date.now();
  let chatPrevContent = '';
  let chatStreamingDetected = false;
  let chatSnapshots = [];
  let chatFinalContent = '';
  
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    
    const chatContent = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[class*="whitespace-pre-wrap"]');
      for (const msg of msgs) {
        const text = msg.textContent?.trim() || '';
        if (text.length > 3 && !text.includes('2+2') && !text.includes('Thinking') && text !== 'What is 2+2?') {
          return text;
        }
      }
      return '';
    }).catch(() => '');
    
    const elapsed = Date.now() - chatStartTime;
    if (chatContent && chatContent !== chatPrevContent) {
      const delta = chatContent.length - chatPrevContent.length;
      console.log(`[${elapsed}ms] Chat response length: ${chatContent.length} (delta: +${delta})`);
      if (delta > 0 && delta < 100) {
        chatStreamingDetected = true;
      }
      chatPrevContent = chatContent;
      chatFinalContent = chatContent;
      chatSnapshots.push({ elapsed, length: chatContent.length, delta });
    }
    
    // Check if loading stopped
    const squareBtn = page.locator('button:has(svg.lucide-square)');
    const isLoading = await squareBtn.isVisible().catch(() => false);
    if (!isLoading && chatFinalContent.length > 10) {
      console.log(`[${elapsed}ms] Chat response complete!`);
      await page.screenshot({ path: '/tmp/chat-streaming-final.png' });
      break;
    }
  }
  
  console.log('\nChat streaming detected:', chatStreamingDetected);
  console.log('Chat final response length:', chatFinalContent.length);
  console.log('Chat snapshots:', JSON.stringify(chatSnapshots.slice(0, 15)));
  if (chatFinalContent) {
    console.log('Chat response preview:', chatFinalContent.substring(0, 200));
  }
  
  console.log('\n=== ERRORS ===');
  if (pageErrors.length > 0) {
    console.log('Page errors:', pageErrors.slice(0, 10));
  } else {
    console.log('No page errors');
  }
  const errConsole = consoleMsgs.filter(m => m.includes('[error]'));
  if (errConsole.length > 0) {
    console.log('Console errors:', errConsole.slice(0, 10));
  } else {
    console.log('No console errors');
  }
  
  // Summary
  console.log('\n========================================');
  console.log('         TEST SUMMARY');
  console.log('========================================');
  console.log('Landing page loaded: YES');
  console.log('Playground visible: ' + (playgroundVisible ? 'YES' : 'NO'));
  console.log('Playground streaming: ' + (streamingDetected ? 'YES - tokens arrived incrementally' : (finalContent ? 'PARTIAL - got response but couldn\'t confirm incremental' : 'NO - no response received')));
  console.log('/chat page loaded: YES');
  console.log('Chat page streaming: ' + (chatStreamingDetected ? 'YES - tokens arrived incrementally' : (chatFinalContent ? 'PARTIAL - got response but couldn\'t confirm incremental' : 'NO - no response received')));
  console.log('Page errors: ' + (pageErrors.length > 0 ? pageErrors.length + ' errors' : 'None'));
  console.log('========================================');
  
  await browser.close();
})();
