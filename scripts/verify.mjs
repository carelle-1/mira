import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const errors = [];
const overflows = [];
await mkdir('.artifacts',{recursive:true});
const context = await browser.newContext({viewport:{width:1280,height:853},reducedMotion:'reduce'});
const page = await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
const routes = ['','profil','sources','mentions','analyse','alertes','crise','contenus','medias','rapports','protection','parametres','premium'];
try {
  for (const route of routes) {
    const width = ['protection','parametres'].includes(route) ? 1168 : route === '' ? 1440 : 1280;
    const height = ['protection','parametres'].includes(route) ? 784 : route === '' ? 900 : route === 'premium' ? 888 : 853;
    await page.setViewportSize({width,height});
    const response=await page.goto(`${base}/${route}`,{waitUntil:'networkidle'});
    assert.equal(response.status(),200,`Route /${route}`);
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('.global-loading').waitFor({state:'hidden',timeout:15000});
    assert.ok(await page.locator('h1').first().isVisible(),`Heading /${route}`);
    const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight,contentHeight:document.documentElement.scrollHeight}));
    if(metrics.scroll>metrics.width+2)overflows.push({route:route||'dashboard',...metrics});
    await page.screenshot({path:`.artifacts/${route||'dashboard'}-desktop.png`,fullPage:true});
    console.log(`DESKTOP /${route} ${JSON.stringify(metrics)}`);
  }
  await page.setViewportSize({width:1080,height:720});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.screenshot({path:'.artifacts/dashboard-reference.png',fullPage:true});
  for(const route of routes){
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${base}/${route}`,{waitUntil:'networkidle'});
    const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    if(metrics.scroll>metrics.width+2)overflows.push({route:`mobile-${route||'dashboard'}`,...metrics});
    if(['','protection','parametres','premium'].includes(route))await page.screenshot({path:`.artifacts/${route||'dashboard'}-mobile.png`,fullPage:true});
    console.log(`MOBILE /${route} ${JSON.stringify(metrics)}`);
  }
  await page.getByRole('button',{name:'Ouvrir la navigation'}).click();
  assert.ok(await page.locator('.sidebar-open').isVisible());
  await page.locator('nav').getByRole('link',{name:'Protection de l’identité'}).click();
  await page.waitForURL('**/protection');
  console.log('PASS mobile navigation');
  if(process.argv.includes('--visual')){
    console.log('BROWSER ERRORS',JSON.stringify(errors));console.log('OVERFLOWS',JSON.stringify(overflows));
  } else {
    class Api {
      cookie='';
      async call(path,method='GET',body){
        const response=await fetch(base+path,{method,headers:{...(this.cookie?{Cookie:this.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const cookies=response.headers.getSetCookie();
        for(const cookie of cookies)if(cookie.startsWith('ghostroar_session='))this.cookie=cookie.split(';')[0];
        const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
        return {status:response.status,data,headers:response.headers};
      }
    }
    const anonymous=new Api();
    assert.equal((await anonymous.call('/api/resources/mentions','POST',{name:'Unauthorized'})).status,401);
    const api=new Api();
    const suffix=Date.now();
    const email=`qa-${suffix}@ghostroar.test`;
    const password=`Qa!${randomBytes(16).toString('hex')}`;
    const registration=await api.call('/api/auth/register','POST',{name:'Compte QA',email,password});
    assert.equal(registration.status,201,JSON.stringify(registration.data));
    const workspace=await api.call('/api/workspace');
    assert.equal(workspace.data.user.email,email);
    assert.equal(workspace.data.data.profile[0].name,'Compte QA');
    assert.equal(workspace.data.data.threats.length,4);
    assert.equal(workspace.data.data.monitors.length,12);
    console.log('PASS registration, authenticated workspace, personalized seed');
    const qa=await browser.newContext({viewport:{width:1280,height:853}});
    const cookieValue=api.cookie.split('=').slice(1).join('=');
    await qa.addCookies([{name:'ghostroar_session',value:cookieValue,url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https')}]);
    const q=await qa.newPage();q.on('pageerror',error=>errors.push(error.message));
    await q.goto(base+'/parametres',{waitUntil:'networkidle'});
    await q.getByLabel('Téléphone',{exact:true}).fill('+237 600 000 123');
    await q.getByRole('switch',{name:'Recevoir les notifications par email',exact:true}).click();
    const saved=q.waitForResponse(r=>r.url().endsWith('/api/account')&&r.request().method()==='PATCH');
    await q.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
    assert.equal((await saved).status(),200);
    await q.locator('.toast').waitFor();
    await q.reload({waitUntil:'networkidle'});
    assert.equal(await q.getByLabel('Téléphone',{exact:true}).inputValue(),'+237 600 000 123');
    assert.equal(await q.getByRole('switch',{name:'Recevoir les notifications par email',exact:true}).getAttribute('aria-checked'),'false');
    for(const title of ['Notifications','Sécurité','Intégrations','Abonnement','Préférences','Compte']){
      await q.getByRole('tab',{name:title,exact:true}).click();
      assert.ok(await q.locator('.settings-page').isVisible());
    }
    await q.getByRole('textbox',{name:'Rechercher dans Ghostroar'}).fill('mot de passe');
    await q.locator('.search-popover').getByRole('button').first().click();
    assert.equal(await q.getByRole('tab',{name:'Sécurité',exact:true}).getAttribute('aria-selected'),'true');
    console.log('PASS all settings tabs, targeted search, and persisted account changes');
    await q.goto(base+'/protection',{waitUntil:'networkidle'});
    const resolved=q.waitForResponse(r=>r.url().includes('/api/resources/threats/')&&r.request().method()==='PATCH');
    await q.getByRole('button',{name:'Marquer résolu',exact:true}).first().click();
    assert.equal((await resolved).status(),200);
    await q.getByRole('button',{name:'Résolues',exact:true}).click();
    assert.equal(await q.locator('.threat-card').count(),2);
    await q.getByRole('button',{name:'Ajouter une surveillance',exact:true}).click();
    await q.getByLabel('Nom de la surveillance').fill('Surveillance QA persistante');
    await q.getByLabel('URL officielle à surveiller').fill('https://example.com/official');
    const created=q.waitForResponse(r=>r.url().endsWith('/api/resources/monitors')&&r.request().method()==='POST');
    await q.getByRole('button',{name:'Créer',exact:true}).click();
    assert.equal((await created).status(),201);
    await q.getByRole('dialog').waitFor({state:'hidden'});
    await q.reload({waitUntil:'networkidle'});
    await q.getByRole('button',{name:'Voir tous les moniteurs',exact:true}).click();
    assert.ok(await q.getByText('Surveillance QA persistante',{exact:true}).isVisible());
    await q.getByRole('button',{name:'Fermer la fenêtre',exact:true}).click();
    console.log('PASS threat resolution, filters, monitor creation and persistence');
    await q.goto(base+'/premium',{waitUntil:'networkidle'});
    await q.getByRole('button',{name:'Choisir Premium',exact:true}).click();
    assert.ok(await q.getByText('Mode démonstration',{exact:true}).isVisible());
    const changed=q.waitForResponse(r=>r.url().endsWith('/api/subscription')&&r.request().method()==='POST');
    await q.getByRole('button',{name:'Confirmer le changement',exact:true}).click();
    assert.equal((await changed).status(),200);
    await q.getByRole('dialog').waitFor({state:'hidden'});
    await q.reload({waitUntil:'networkidle'});
    assert.ok(await q.locator('.pricing-premium').getByRole('button',{name:'Plan actuel',exact:true}).isDisabled());
    assert.equal((await api.call('/api/workspace')).data.data.subscriptions[0].plan,'premium');
    console.log('PASS premium confirmation and persistent subscription');
    for(const type of ['sources','mentions','alerts','publications','contacts','reports','rules','crises','appointments','campaigns','threats','monitors']){
      const created=await api.call(`/api/resources/${type}`,'POST',{name:`QA ${type}`,description:'Test de persistance',url:'https://example.com/qa',status:'active'});
      assert.equal(created.status,201,`${type}: ${JSON.stringify(created.data)}`);
      const id=created.data.id;
      assert.equal((await api.call(`/api/resources/${type}/${id}`,'PATCH',{name:`QA ${type} modifié`})).status,200);
      assert.equal((await api.call(`/api/resources/${type}/${id}`)).data[0].name,`QA ${type} modifié`);
      assert.equal((await api.call(`/api/resources/${type}/${id}`,'DELETE')).status,200);
      assert.equal((await api.call(`/api/resources/${type}/${id}`)).data.length,0);
    }
    assert.equal((await api.call('/api/resources/mentions','POST',{name:'A'})).status,400);
    assert.equal((await api.call('/api/resources/sources','POST',{name:'Bad url',url:'javascript:alert(1)'})).status,400);
    assert.equal((await api.call('/api/resources/mentions','POST',{name:'Bad score',score:101})).status,400);
    console.log('PASS CRUD for 12 resources and input validation');
    const scan=await api.call('/api/identity/scan','POST');
    assert.equal(scan.status,200);assert.equal(scan.data.scanned,13);assert.ok(scan.data.report.description.includes('Aucune recherche externe'));
    const analysis=await api.call('/api/actions/analyze','POST');
    assert.equal(analysis.status,200);assert.equal(analysis.data.total,15);
    const csv=await api.call('/api/export?type=mentions');
    assert.equal(csv.status,200);assert.ok(csv.headers.get('content-disposition').includes('.csv'));assert.ok(csv.data.includes('name;description'));
    console.log('PASS local identity scan, reputation analysis and CSV export');
    const ownerRecord=await api.call('/api/resources/reports','POST',{name:'Private QA report'});
    const other=new Api();
    assert.equal((await other.call('/api/auth/register','POST',{name:'Autre compte QA',email:`other-${suffix}@ghostroar.test`,password})).status,201);
    assert.equal((await other.call(`/api/resources/reports/${ownerRecord.data.id}`,'PATCH',{name:'Forbidden edit'})).status,404);
    assert.equal((await other.call(`/api/resources/reports/${ownerRecord.data.id}`,'DELETE')).status,404);
    assert.equal((await other.call(`/api/resources/reports/${ownerRecord.data.id}`)).data.length,0);
    console.log('PASS account isolation');
    const setup=await api.call('/api/security','POST',{action:'setup'});assert.equal(setup.status,200);
    function totp(secret){const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0;const bytes=[];for(const c of secret){value=(value<<5)|chars.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=h[h.length-1]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
    assert.equal((await api.call('/api/security','POST',{action:'enable',code:totp(setup.data.secret)})).status,200);
    assert.equal((await api.call('/api/security')).data.twoFactorEnabled,true);
    assert.equal((await api.call('/api/auth/logout','POST')).status,200);
    const blocked=await api.call('/api/auth/login','POST',{email,password});assert.equal(blocked.status,401);assert.equal(blocked.data.requiresTwoFactor,true);
    assert.equal((await api.call('/api/auth/login','POST',{email,password,code:totp(setup.data.secret)})).status,200);
    const secondSession=new Api();assert.equal((await secondSession.call('/api/auth/login','POST',{email,password,code:totp(setup.data.secret)})).status,200);
    assert.ok((await api.call('/api/security')).data.sessions.length>=2);
    assert.equal((await api.call('/api/security','POST',{action:'revoke'})).status,200);
    assert.equal((await secondSession.call('/api/security')).status,401);
    assert.equal((await api.call('/api/security')).data.sessions.length,1);
    assert.equal((await api.call('/api/security','POST',{action:'disable',code:totp(setup.data.secret)})).status,200);
    console.log('PASS real TOTP setup, required login challenge, session revocation and disable');
    await qa.close();
    console.log('BROWSER ERRORS',JSON.stringify(errors));
    console.log('OVERFLOWS',JSON.stringify(overflows));
    assert.equal(errors.length,0,'Browser runtime errors');
    assert.equal(overflows.length,0,'Horizontal page overflow');
    console.log('ALL GHOSTROAR TESTS PASSED');
  }
} finally {await browser.close();}
