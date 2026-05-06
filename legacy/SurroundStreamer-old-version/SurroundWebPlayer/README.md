# Icecast HRTF Monitor

Web Audio APIでIcecastストリームを受信し、最大8チャンネルを個別のHRTF `PannerNode`へ送ってバイノーラルで聴取する静的Webページです。

## 使い方

ローカルサーバーで開きます。

```sh
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開き、IcecastのストリームURLを入力して再生します。既定では `https://mp3-proxy.onrender.com/` を前置してCORSヘッダー付きのプロキシ経由で接続します。

## 注意

- CORS ProxyをOffにする場合、Icecast側がWeb Audio APIから読めるCORSヘッダーを返す必要があります。
- ブラウザとコーデックの組み合わせにより、マルチチャンネルストリームがステレオへダウンミックスされる場合があります。
- 5.1の既定チャンネル順は `L, R, C, LFE, Ls, Rs`、7.1は `L, R, C, LFE, Ls, Rs, Lb, Rb` です。
