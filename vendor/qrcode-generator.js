// Self-contained QR code generator — byte mode, EC level H
// Exposes: qrcode(typeNumber) with addData/make/getModuleCount/isDark API
(function(root) {
  // GF(256)
  var L = new Uint8Array(256), X = new Uint8Array(512);
  (function() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      X[i] = x; L[x] = i;
      x <<= 1; if (x & 256) x ^= 0x11d;
    }
    X[255] = 1;
    for (var i = 256; i < 512; i++) X[i] = X[i - 255];
  })();
  function gm(a, b) { return (a && b) ? X[L[a] + L[b]] : 0; }

  // Reed-Solomon encode: returns ecLen EC codewords
  function rsEnc(data, ecLen) {
    var g = [1];
    for (var i = 0; i < ecLen; i++) {
      var n = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j+1] ^= gm(g[j], X[i]); }
      g = n;
    }
    var d = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      if (!d[i]) continue;
      for (var j = 1; j <= ecLen; j++) d[i+j] ^= gm(d[i], g[j]);
    }
    return d.slice(data.length);
  }

  // RS blocks: EC level H only [count, total, data, ...]
  var RSH = [
    [1,26,9],[1,44,16],[2,35,13],[4,25,9],[2,33,11,2,34,12],
    [4,43,15],[4,39,13,1,40,14],[4,40,14,2,41,15],[4,36,12,4,37,13],[6,43,15,2,44,16],
    [3,36,12,8,37,13],[7,42,14,4,43,15],[12,33,11,4,34,12],[11,36,12,5,37,13],[11,36,12,7,37,13],
    [3,45,15,13,46,16],[2,42,14,17,43,15],[2,42,14,19,43,15],[9,39,13,16,40,14],[15,43,15,10,44,16],
    [19,46,16,6,47,17],[34,37,13],[16,45,15,14,46,16],[30,46,16,2,47,17],[22,45,15,13,46,16],
    [33,46,16,4,47,17],[12,45,15,28,46,16],[11,45,15,31,46,16],[19,45,15,26,46,16],[23,45,15,25,46,16],
    [23,45,15,28,46,16],[19,45,15,35,46,16],[11,45,15,46,46,16],[59,46,16,1,47,17],[22,45,15,41,46,16],
    [2,45,15,64,46,16],[24,45,15,46,46,16],[42,45,15,32,46,16],[10,45,15,67,46,16],[20,45,15,61,46,16]
  ];
  function dataCap(v) { var t=RSH[v-1], s=0; for(var i=0;i<t.length;i+=3) s+=t[i]*t[i+2]; return s; }

  // Alignment pattern centres (0-indexed by version-1)
  var AP = [
    [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
    [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
    [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],
    [6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],
    [6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],
    [6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],
    [6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
  ];

  // Remainder bits per version (1-indexed)
  var REM = [0,7,7,7,7,7,0,0,0,0,0,0,0,3,3,3,3,3,3,3,4,4,4,4,4,4,4,3,3,3,3,3,3,3,0,0,0,0,0,0];

  // BCH helpers
  function bchD(d) { var n=0; while(d){n++;d>>>=1;} return n; }
  function fmtBCH(d) { var r=d<<10, G=0x537; while(bchD(r)>=bchD(G)) r^=G<<(bchD(r)-bchD(G)); return ((d<<10)|r)^0x5412; }
  function verBCH(d) { var r=d<<12, G=0x1F25; while(bchD(r)>=bchD(G)) r^=G<<(bchD(r)-bchD(G)); return (d<<12)|r; }

  // Mask condition
  function masked(p, r, c) {
    switch(p) {
      case 0: return (r+c)%2===0;
      case 1: return r%2===0;
      case 2: return c%3===0;
      case 3: return (r+c)%3===0;
      case 4: return (Math.floor(r/2)+Math.floor(c/3))%2===0;
      case 5: return (r*c)%2+(r*c)%3===0;
      case 6: return ((r*c)%2+(r*c)%3)%2===0;
      case 7: return ((r+c)%2+(r*c)%3)%2===0;
    }
  }

  // Penalty score
  function score(m, n) {
    var pen = 0, i, j, k, run;
    for (i=0; i<n; i++) {
      run=1;
      for (j=1; j<n; j++) { if(m[i][j]===m[i][j-1]){if(++run===5)pen+=3;else if(run>5)pen++;} else run=1; }
      run=1;
      for (j=1; j<n; j++) { if(m[j][i]===m[j-1][i]){if(++run===5)pen+=3;else if(run>5)pen++;} else run=1; }
    }
    for (i=0; i<n-1; i++) for (j=0; j<n-1; j++)
      if (m[i][j]===m[i][j+1] && m[i][j]===m[i+1][j] && m[i][j]===m[i+1][j+1]) pen+=3;
    var pat1=[1,0,1,1,1,0,1,0,0,0,0], pat2=[0,0,0,0,1,0,1,1,1,0,1];
    for (i=0; i<n; i++) for (j=0; j<=n-11; j++) {
      var h1=1,h2=1,v1=1,v2=1;
      for (k=0; k<11; k++) {
        if(m[i][j+k]!==pat1[k]) h1=0;
        if(m[i][j+k]!==pat2[k]) h2=0;
        if(i+k<n&&m[i+k][j]!==pat1[k]) v1=0;
        if(i+k<n&&m[i+k][j]!==pat2[k]) v2=0;
      }
      if(h1) pen+=40; if(h2) pen+=40; if(v1) pen+=40; if(v2) pen+=40;
    }
    var dark=0; for(i=0;i<n;i++) for(j=0;j<n;j++) dark+=m[i][j];
    var rat=dark*100/(n*n), p5=Math.floor(rat/5)*5;
    pen += Math.min(Math.abs(p5-50), Math.abs(p5+5-50))/5*10;
    return pen;
  }

  function buildMatrix(ver, cwBits, maskPat) {
    var n = 4*ver+17;
    var m = [], fn = [];
    for (var r=0; r<n; r++) { m[r]=[]; fn[r]=[]; for(var c=0;c<n;c++){m[r][c]=0;fn[r][c]=false;} }

    function sf(r,c,v) { m[r][c]=v?1:0; fn[r][c]=true; }

    var FP=[1,1,1,1,1,1,1,1,0,0,0,0,0,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,0,0,0,0,0,1,1,1,1,1,1,1,1];
    function finder(tr, tc) { for(var r=0;r<7;r++) for(var c=0;c<7;c++) sf(tr+r,tc+c,FP[r*7+c]); }
    finder(0,0); finder(0,n-7); finder(n-7,0);

    for (var i=0; i<8; i++) {
      if(!fn[7][i])         sf(7,i,0);
      if(!fn[i][7])         sf(i,7,0);
      if(!fn[7][n-8+i])     sf(7,n-8+i,0);
      if(i<7&&!fn[i][n-8])  sf(i,n-8,0);
      if(!fn[n-8][i])       sf(n-8,i,0);
      if(i>0&&!fn[n-8+i][7]) sf(n-8+i,7,0);
    }

    for (var i=8; i<n-8; i++) {
      if(!fn[6][i]) sf(6,i,i%2===0);
      if(!fn[i][6]) sf(i,6,i%2===0);
    }

    var ap = AP[ver-1];
    for (var a=0; a<ap.length; a++) for (var b=0; b<ap.length; b++) {
      var ar=ap[a], ac=ap[b];
      if (fn[ar][ac]) continue;
      for (var dr=-2; dr<=2; dr++) for (var dc=-2; dc<=2; dc++)
        sf(ar+dr, ac+dc, (Math.abs(dr)===2||Math.abs(dc)===2||(dr===0&&dc===0)));
    }

    sf(4*ver+9, 8, 1);

    var FMT1=[[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]];
    var FMT2=[[8,n-1],[8,n-2],[8,n-3],[8,n-4],[8,n-5],[8,n-6],[8,n-7],[8,n-8],[n-7,8],[n-6,8],[n-5,8],[n-4,8],[n-3,8],[n-2,8],[n-1,8]];
    for (var i=0; i<15; i++) { sf(FMT1[i][0],FMT1[i][1],0); sf(FMT2[i][0],FMT2[i][1],0); }

    if (ver >= 7) {
      for (var i=0; i<18; i++) {
        sf(Math.floor(i/3), i%3+n-11, 0);
        sf(i%3+n-11, Math.floor(i/3), 0);
      }
    }

    var idx=0, col=n-1, up=true;
    while (col > 0) {
      if (col===6) col--;
      for (var ri=0; ri<n; ri++) {
        var row = up ? (n-1-ri) : ri;
        for (var dc=0; dc<2; dc++) {
          var c=col-dc;
          if (!fn[row][c]) { m[row][c] = idx<cwBits.length ? cwBits[idx++] : 0; }
        }
      }
      col-=2; up=!up;
    }

    for (var r=0; r<n; r++) for (var c=0; c<n; c++)
      if (!fn[r][c] && masked(maskPat,r,c)) m[r][c]^=1;

    var fmtBits = fmtBCH((2<<3)|maskPat);
    for (var i=0; i<15; i++) {
      var bit=(fmtBits>>i)&1;
      m[FMT1[i][0]][FMT1[i][1]]=bit; m[FMT2[i][0]][FMT2[i][1]]=bit;
    }

    if (ver >= 7) {
      var vb = verBCH(ver);
      for (var i=0; i<18; i++) {
        var bit=(vb>>i)&1;
        m[Math.floor(i/3)][i%3+n-11]=bit;
        m[i%3+n-11][Math.floor(i/3)]=bit;
      }
    }

    return m;
  }

  root.qrcode = function(typeNumber) {
    var _ver = typeNumber, _str = '', _m = null, _n = 0;
    return {
      addData: function(s) { _str += s; },
      make: function() {
        var bytes = unescape(encodeURIComponent(_str)).split('').map(function(c){return c.charCodeAt(0);});

        if (!_ver) {
          for (_ver=1; _ver<=40; _ver++) {
            var cb = _ver<10 ? 8 : 16;
            if (dataCap(_ver)*8 >= 4+cb+bytes.length*8) break;
          }
        }
        _n = 4*_ver+17;

        var bits = [];
        function put(v,len) { for(var i=len-1;i>=0;i--) bits.push((v>>i)&1); }
        var cb = _ver<10 ? 8 : 16;
        put(4,4); put(bytes.length,cb);
        for (var i=0;i<bytes.length;i++) put(bytes[i],8);
        var cap = dataCap(_ver)*8;
        for (var i=0;i<4&&bits.length<cap;i++) bits.push(0);
        while (bits.length%8) bits.push(0);
        var pad=[0xec,0x11],pi=0;
        while (bits.length<cap) put(pad[pi++%2],8);

        var dcw=[];
        for (var i=0;i<bits.length;i+=8) { var b=0; for(var j=0;j<8;j++) b=(b<<1)|bits[i+j]; dcw.push(b); }

        var t=RSH[_ver-1], blocks=[], pos=0;
        for (var g=0;g<t.length;g+=3) for (var bi=0;bi<t[g];bi++) {
          var bd=dcw.slice(pos,pos+t[g+2]);
          blocks.push({d:bd, e:rsEnc(bd,t[g+1]-t[g+2])});
          pos+=t[g+2];
        }

        var cw=[];
        var maxD=Math.max.apply(null,blocks.map(function(b){return b.d.length;}));
        for(var j=0;j<maxD;j++) for(var i=0;i<blocks.length;i++) if(j<blocks[i].d.length) cw.push(blocks[i].d[j]);
        var ecL=blocks[0].e.length;
        for(var j=0;j<ecL;j++) for(var i=0;i<blocks.length;i++) cw.push(blocks[i].e[j]);

        var cwBits=[];
        for(var i=0;i<cw.length;i++) for(var b=7;b>=0;b--) cwBits.push((cw[i]>>b)&1);
        for(var i=0;i<REM[_ver-1];i++) cwBits.push(0);

        var best=0, bestP=Infinity;
        for(var mp=0;mp<8;mp++){
          var mm=buildMatrix(_ver,cwBits,mp);
          var p=score(mm,_n);
          if(p<bestP){bestP=p;best=mp;}
        }
        _m = buildMatrix(_ver,cwBits,best);
      },
      getModuleCount: function() { return _n; },
      isDark: function(r,c) { return _m[r][c]===1; }
    };
  };
})(typeof window !== 'undefined' ? window : exports);
