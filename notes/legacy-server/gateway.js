const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({limit:'2mb'}));

const API_TARGET = 'http://127.0.0.1:3101';

app.use('/api', async (req, res) => {
  try {
    const subPath = req.originalUrl.replace(/^\/api/, '') || '/';
    const url = API_TARGET + subPath;
    const headers = { ...req.headers };
    delete headers.host;
    const init = {
      method: req.method,
      headers,
      redirect: 'manual'
    };
    if (!['GET','HEAD'].includes(req.method)) {
      init.body = JSON.stringify(req.body || {});
      init.headers['content-type'] = 'application/json';
    }
    const r = await fetch(url, init);
    const text = await r.text();
    res.status(r.status);
    r.headers.forEach((v,k)=>{
      if (['content-type','set-cookie'].includes(k.toLowerCase())) res.setHeader(k,v);
    });
    res.send(text);
  } catch (e) {
    res.status(502).json({ ok:false, error:'proxy_error', message:String(e) });
  }
});

app.use(express.static(path.join(__dirname, 'web'), { etag:false, maxAge:0 }));
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'web','index.html')));

app.listen(3100, '0.0.0.0', ()=>console.log('Gateway web+api on 0.0.0.0:3100'));
