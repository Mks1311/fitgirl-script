const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { links } = require('./links');

// ===== CONFIGURATION FLAGS =====
const SHUTDOWN_AFTER_COMPLETION = false;
const MAX_DOWNLOAD_RETRIES = 3; // Maximum retry attempts per download
const MAX_CONCURRENT = 5; // Maximum concurrent downloads
// ===============================

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

function getDownloadedFiles(downloadPath) {
    if (!fs.existsSync(downloadPath)) return [];
    return fs.readdirSync(downloadPath).filter(file => 
        !file.endsWith('.crdownload') && !file.endsWith('.tmp')
    );
}

function getActiveDownloads(downloadPath) {
    if (!fs.existsSync(downloadPath)) return 0;
    const files = fs.readdirSync(downloadPath);
    return files.filter(file => 
        file.endsWith('.crdownload') || file.endsWith('.tmp')
    ).length;
}

async function waitForDownloadsToComplete(downloadPath, maxActive = 5) {
    console.log('Waiting for downloads to complete...');
    while (true) {
        const activeDownloads = getActiveDownloads(downloadPath);
        console.log(`Active downloads: ${activeDownloads}`);
        
        if (activeDownloads < maxActive) {
            break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

function shutdownSystem() {
    console.log('\n🔴 Initiating system shutdown in 10 seconds...');
    console.log('Press Ctrl+C to cancel!');
    
    exec('shutdown /s /t 10', (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Shutdown failed: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Shutdown stderr: ${stderr}`);
            return;
        }
        console.log('✅ Shutdown initiated successfully');
    });
}

async function clickDownloadButton(page, browser, url, maxRetries = MAX_DOWNLOAD_RETRIES) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
        attempt++;
        console.log(`  Attempt ${attempt}/${maxRetries}: Clicking download button...`);
        
        try {
            // Wait for download button
            await page.waitForSelector('.gay-button', { timeout: 15000 });
            
            // Get current number of pages
            const pagesBefore = await browser.pages();
            const pagesCountBefore = pagesBefore.length;
            
            // Click the button
            await page.click('.gay-button');
            
            // Wait for potential new tab to open
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check if a new tab was opened
            const pagesAfter = await browser.pages();
            const pagesCountAfter = pagesAfter.length;
            
            if (pagesCountAfter > pagesCountBefore) {
                // New tab was opened - get the new page
                const newPage = pagesAfter[pagesAfter.length - 1];
                
                try {
                    // Wait a bit for the page to load
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const newPageUrl = newPage.url();
                    const newPageDomain = new URL(newPageUrl).hostname;
                    
                    console.log(`  📄 New tab opened: ${newPageDomain}`);
                    
                    if (newPageDomain.includes('fuckingfast.co')) {
                        console.log(`  ✅ New tab is on fuckingfast.co - download initiated!`);
                        // Close the new tab as download has started
                        await newPage.close().catch(() => {});
                        return true;
                    } else {
                        console.log(`  ⚠️  New tab redirected to ${newPageDomain} - fake link detected`);
                        // Close the fake ad tab
                        await newPage.close().catch(() => {});
                        
                        if (attempt < maxRetries) {
                            console.log(`  🔄 Retrying...`);
                            // Navigate back to original URL
                            await page.goto(url, { 
                                waitUntil: 'networkidle2',
                                timeout: 60000 
                            });
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                } catch (error) {
                    console.log(`  ❌ Error checking new tab:`, error.message);
                    await newPage.close().catch(() => {});
                }
            } else {
                // No new tab - check if current page redirected
                const currentUrl = page.url();
                const currentDomain = new URL(currentUrl).hostname;
                
                if (currentDomain.includes('fuckingfast.co')) {
                    console.log(`  ✅ Still on fuckingfast.co - download initiated!`);
                    return true;
                } else {
                    console.log(`  ⚠️  Redirected to ${currentDomain} - fake link detected`);
                    
                    if (attempt < maxRetries) {
                        console.log(`  🔄 Retrying...`);
                        await page.goto(url, { 
                            waitUntil: 'networkidle2',
                            timeout: 60000 
                        });
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            
        } catch (error) {
            console.log(`  ❌ Error on attempt ${attempt}:`, error.message);
            
            if (attempt < maxRetries) {
                console.log(`  🔄 Retrying...`);
                try {
                    await page.goto(url, { 
                        waitUntil: 'networkidle2',
                        timeout: 60000 
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (navError) {
                    console.log(`  ❌ Navigation error:`, navError.message);
                }
            }
        }
    }
    
    console.log(`  ❌ Failed after ${maxRetries} attempts`);
    return false;
}

async function downloadFiles(urls) {
    const downloadPath = path.resolve('./downloads');

    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    }

    const browser = await puppeteer.launch({
        headless: false,
        protocolTimeout: 180000,
        args: [
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=site-per-process',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();

    // Prevent page from being throttled
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'hidden', {
            get: function() { return false; }
        });
        Object.defineProperty(document, 'visibilityState', {
            get: function() { return 'visible'; }
        });
    });

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });

    let activeDownloads = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        
        if (activeDownloads >= MAX_CONCURRENT) {
            console.log(`\n⏸️  Max concurrent downloads (${MAX_CONCURRENT}) reached. Waiting...`);
            await waitForDownloadsToComplete(downloadPath, MAX_CONCURRENT);
            activeDownloads = getActiveDownloads(downloadPath);
        }

        console.log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);
        
        try {
            await page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Try to click download button with retry logic
            const success = await clickDownloadButton(page, browser, url);
            
            if (success) {
                activeDownloads++;
                successCount++;
                console.log(`  ✅ Download started! (Active: ${activeDownloads}, Success: ${successCount}/${i + 1})`);
            } else {
                failCount++;
                console.log(`  ❌ Failed to start download (Failed: ${failCount}/${i + 1})`);
            }

            // Small delay before next link
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (error) {
            failCount++;
            console.log(`  ❌ Error processing link ${i + 1}:`, error.message);
        }

        // Update active downloads count
        activeDownloads = getActiveDownloads(downloadPath);
    }

    // Wait for all remaining downloads to complete
    console.log('\n⏳ Waiting for all remaining downloads to finish...');
    while (getActiveDownloads(downloadPath) > 0) {
        const active = getActiveDownloads(downloadPath);
        const completed = getDownloadedFiles(downloadPath).length;
        console.log(`Active: ${active} | Completed: ${completed}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const totalCompleted = getDownloadedFiles(downloadPath).length;
    console.log(`\n🎉 All downloads complete!`);
    console.log(`📊 Statistics:`);
    console.log(`   - Total links: ${urls.length}`);
    console.log(`   - Successful: ${successCount}`);
    console.log(`   - Failed: ${failCount}`);
    console.log(`   - Files downloaded: ${totalCompleted}`);

    await browser.close();
    
    if (SHUTDOWN_AFTER_COMPLETION) {
        shutdownSystem();
    } else {
        console.log('\n✅ Script completed (auto-shutdown disabled)');
    }
}

const urls = links;

console.log(`Starting download of ${urls.length} files (Max ${MAX_CONCURRENT} concurrent)`);
console.log(`Max retries per download: ${MAX_DOWNLOAD_RETRIES}`);
if (SHUTDOWN_AFTER_COMPLETION) {
    console.log('⚠️  AUTO-SHUTDOWN ENABLED - System will shutdown after completion\n');
} else {
    console.log('ℹ️  Auto-shutdown disabled\n');
}

downloadFiles(urls);