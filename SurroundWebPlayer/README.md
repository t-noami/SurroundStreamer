# Icecast HRTF Monitor

Web Audio APIでIcecastストリームを受信し、最大12チャンネルを個別のHRTF `PannerNode`へ送ってバイノーラルで聴取する静的Webページです。

## 使い方

ローカルサーバーで開きます。

```sh
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開き、IcecastのストリームURLを入力して再生します。既定では `https://mp3-proxy.onrender.com/` を前置してCORSヘッダー付きのプロキシ経由で接続します。

## 注意

- CORS ProxyをOffにする場合、Icecast側がWeb Audio APIから読めるCORSヘッダーを返す必要があります。
- ブラウザとコーデックの組み合わせにより、マルチチャンネルストリームがステレオへダウンミックスされる場合があります。
- 5.1の既定チャンネル順は `L, R, C, LFE, Ls, Rs`、7.1は `L, R, C, LFE, Ls, Rs, Lb, Rb`、7.1.2は `L, R, C, LFE, Ls, Rs, Lb, Rb, Ltm, Rtm`、7.1.4は `L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltr, Rtr` です。
- `DIST` はWeb Audio APIの座標系に合わせた相対単位 `u` です。リスナー位置を原点 `0` とし、メートル等の物理単位としては扱いません。
