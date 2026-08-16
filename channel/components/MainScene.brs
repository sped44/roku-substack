sub init()
    m.top.setFocus(true)

    m.chrome = m.top.findNode("chrome")
    m.titleLabel = m.top.findNode("titleLabel")
    m.statusLabel = m.top.findNode("statusLabel")
    m.codeLabel = m.top.findNode("codeLabel")
    m.hintLabel = m.top.findNode("hintLabel")
    m.qrPoster = m.top.findNode("qrPoster")
    m.homeList = m.top.findNode("homeList")
    m.authorGrid = m.top.findNode("authorGrid")
    m.videoPlayer = m.top.findNode("videoPlayer")
    m.audioPlayer = m.top.findNode("audioPlayer")
    m.audioChrome = m.top.findNode("audioChrome")
    m.audioTitle = m.top.findNode("audioTitle")
    m.audioSubtitle = m.top.findNode("audioSubtitle")

    m.registry = CreateObject("roRegistrySection", "roku_substack")
    m.deviceToken = m.registry.read("device_token")
    m.apiBaseUrl = resolveApiBaseUrl()
    m.httpPurpose = ""
    m.httpRequestId = 0
    m.phase = "init"
    m.homeData = invalid
    m.authorPosts = invalid
    m.searchQuery = ""
    m.searchData = invalid
    m.returnPhase = "home"
    m.hidePaid = false
    savedHide = m.registry.read("hide_paid")
    if savedHide = "1" then
        m.hidePaid = true
    end if

    m.pollTimer = CreateObject("roSGNode", "Timer")
    m.pollTimer.repeat = true
    m.pollTimer.duration = 2
    m.pollTimer.observeField("fire", "onPollTimer")

    m.homeList.observeField("rowItemSelected", "onHomeItemSelected")
    m.authorGrid.observeField("itemSelected", "onAuthorItemSelected")
    m.videoPlayer.observeField("state", "onVideoState")
    m.audioPlayer.observeField("state", "onAudioState")
    m.audioPlayer.observeField("position", "onAudioPosition")
    m.audioUserPaused = false
    m.audioResumePos = 0
    m.searchPendingQuery = ""
    m.searchPendingGo = false
    m.searchDialogSettled = true
    m.toastLabel = m.top.findNode("toastLabel")
    m.searchOverlay = m.top.findNode("searchOverlay")
    m.searchKeyboard = invalid

    showPairingChrome(true)
    showStatus("Connecting to " + m.apiBaseUrl)

    if m.deviceToken <> invalid and m.deviceToken <> "" then
        fetchHome()
    else
        startPairing()
    end if
end sub

function resolveApiBaseUrl() as string
    saved = m.registry.read("api_base_url")
    if saved <> invalid and saved <> "" then
        return stripTrailingSlash(saved)
    end if
    return stripTrailingSlash(m.top.apiBaseUrl)
end function

function stripTrailingSlash(url as string) as string
    if Right(url, 1) = "/" then
        return Left(url, Len(url) - 1)
    end if
    return url
end function

sub showPairingChrome(show as boolean)
    m.chrome.visible = show
    if show <> true and m.qrPoster <> invalid then
        m.qrPoster.visible = false
    end if
end sub

sub showStatus(text as string)
    m.statusLabel.text = text
    if text <> "" then
        showPairingChrome(true)
    end if
end sub

sub hidePlayers()
    m.audioUserPaused = false
    m.videoPlayer.control = "stop"
    m.videoPlayer.visible = false
    m.audioPlayer.control = "stop"
    m.audioChrome.visible = false
end sub

sub hideBrowse()
    m.homeList.visible = false
    m.authorGrid.visible = false
    hideToast()
    closeSearchOverlay()
end sub

sub showToast(text as string)
    if m.toastLabel = invalid then
        return
    end if
    m.toastLabel.text = text
    m.toastLabel.visible = (text <> "")
end sub

sub hideToast()
    showToast("")
end sub

sub runHttp(method as string, url as string, headers as object, body as string, purpose as string)
    task = CreateObject("roSGNode", "HttpTask")
    task.observeField("response", "onHttpResponse")
    m.httpRequestId = m.httpRequestId + 1
    task.requestId = m.httpRequestId
    task.method = method
    task.url = url
    task.headers = headers
    task.body = body
    m.httpPurpose = purpose
    m.httpTask = task
    task.control = "RUN"
end sub

function authHeaders() as object
    headers = []
    headers.Push("Authorization: Bearer " + m.deviceToken)
    return headers
end function

sub startPairing()
    m.phase = "pair_start"
    hidePlayers()
    hideBrowse()
    showPairingChrome(true)
    showStatus("Starting device pairing…" + Chr(10) + m.apiBaseUrl)
    m.codeLabel.text = ""
    m.hintLabel.text = ""
    if m.qrPoster <> invalid then
        m.qrPoster.uri = ""
        m.qrPoster.visible = false
    end if
    runHttp("POST", m.apiBaseUrl + "/api/pair/start", [], "", "pair_start")
end sub

sub onPollTimer()
    if m.phase <> "pair_poll" then
        return
    end if
    runHttp("GET", m.apiBaseUrl + "/api/pair/status?code=" + m.pairCode, [], "", "pair_poll")
end sub

sub fetchHome()
    m.phase = "home_load"
    hidePlayers()
    hideBrowse()
    m.codeLabel.text = ""
    m.hintLabel.text = ""
    showStatus("Loading your Substack…")
    runHttp("GET", m.apiBaseUrl + "/api/home", authHeaders(), "", "home")
end sub

sub fetchAuthor(pubId as string, title as string)
    m.phase = "author_load"
    m.authorTitle = title
    hidePlayers()
    hideBrowse()
    showStatus("Loading " + title + "…")
    runHttp("GET", m.apiBaseUrl + "/api/publications/" + pubId + "/posts", authHeaders(), "", "author")
end sub

sub fetchPlay(playId as string)
    if m.phase = "home" or m.phase = "author" or m.phase = "search" then
        m.returnPhase = m.phase
    end if
    encoded = playId
    encoded = encoded.Replace(":", "%3A")
    m.pendingPlayId = playId
    runHttp("GET", m.apiBaseUrl + "/api/posts/" + encoded + "/play", authHeaders(), "", "play")
end sub

sub fetchSearch(query as string)
    m.phase = "search_load"
    m.searchQuery = query
    hidePlayers()
    showPairingChrome(false)
    m.statusLabel.text = ""
    if m.homeList.content <> invalid then
        m.homeList.visible = true
        m.homeList.setFocus(true)
    else
        m.top.setFocus(true)
    end if
    showToast("Searching…")
    runHttp("GET", m.apiBaseUrl + "/api/search?q=" + urlEncode(query), authHeaders(), "", "search")
end sub

function urlEncode(value as string) as string
    out = ""
    n = Len(value)
    i = 1
    while i <= n
        ch = Mid(value, i, 1)
        code = Asc(ch)
        safe = false
        if code >= 48 and code <= 57 then
            safe = true
        end if
        if code >= 65 and code <= 90 then
            safe = true
        end if
        if code >= 97 and code <= 122 then
            safe = true
        end if
        if ch = "-" or ch = "_" or ch = "." or ch = "~" then
            safe = true
        end if
        if safe = true then
            out = out + ch
        else if ch = " " then
            out = out + "%20"
        else
            out = out + "%" + hexByte(code)
        end if
        i = i + 1
    end while
    return out
end function

function hexByte(code as integer) as string
    n = code
    if n < 0 then
        n = 0
    end if
    if n > 255 then
        n = 255
    end if
    hi = Int(n / 16)
    lo = n - (hi * 16)
    return hexDigit(hi) + hexDigit(lo)
end function

function hexDigit(n as integer) as string
    digits = "0123456789ABCDEF"
    return Mid(digits, n + 1, 1)
end function

function searchTile() as object
    return {
        id: "search",
        kind: "search",
        title: "Type or speak",
        poster: "pkg:/images/search-tile.png",
        playable: false,
        publicationId: "",
        publicationName: ""
    }
end function

function paidFilterTile() as object
    title = "Paid: shown"
    if m.hidePaid = true then
        title = "Paid: hidden"
    end if
    return {
        id: "paid_filter",
        kind: "paid_filter",
        title: title,
        poster: "pkg:/images/paid-tile.png",
        playable: false,
        publicationId: "",
        publicationName: ""
    }
end function

function shouldShowItem(item as object) as boolean
    if m.hidePaid = true and item.paidOnly = true then
        return false
    end if
    return true
end function

function visibleItems(items as object) as object
    out = []
    if items = invalid then
        return out
    end if
    for each item in items
        if shouldShowItem(item) then
            out.Push(item)
        end if
    end for
    return out
end function

sub toggleHidePaid()
    if m.hidePaid = true then
        m.hidePaid = false
        m.registry.write("hide_paid", "0")
    else
        m.hidePaid = true
        m.registry.write("hide_paid", "1")
    end if
    m.registry.flush()
    if m.phase = "author" or m.phase = "author_load" then
        authorData = {}
        authorData.posts = m.authorPosts
        applyAuthor(authorData)
        return
    end if
    if m.phase = "search" or m.phase = "search_load" then
        applySearch(m.searchData)
        return
    end if
    m.focusPaidTile = true
    applyHome(m.homeData)
end sub

function makeItemNode(item as object) as object
    node = CreateObject("roSGNode", "ContentNode")
    node.title = item.title
    if item.poster <> invalid then
        node.HDPosterUrl = item.poster
    end if
    node.addFields({
        itemId: item.id,
        kind: item.kind,
        playable: item.playable,
        paidOnly: item.paidOnly,
        publicationId: item.publicationId,
        publicationName: item.publicationName,
        subtitle: item.subtitle
    })
    return node
end function

function makeRow(title as string, items as object) as object
    row = CreateObject("roSGNode", "ContentNode")
    row.title = title
    count = 0
    if items <> invalid then
        for each item in items
            row.appendChild(makeItemNode(item))
            count = count + 1
        end for
    end if
    row.addFields({ itemCount: count })
    return row
end function

function rowHasItems(items as object) as boolean
    if items = invalid then
        return false
    end if
    return items.Count() > 0
end function

sub applyHome(data as object)
    if data = invalid then
        showPairingChrome(true)
        showStatus("Home data missing. Press * to re-pair.")
        return
    end if
    m.homeData = data
    content = CreateObject("roSGNode", "ContentNode")
    content.appendChild(makeRow("Search", [searchTile(), paidFilterTile()]))
    if rowHasItems(visibleItems(data.recentVideo)) then
        content.appendChild(makeRow("Recent video", visibleItems(data.recentVideo)))
    end if
    if rowHasItems(visibleItems(data.recentAudio)) then
        content.appendChild(makeRow("Recent audio", visibleItems(data.recentAudio)))
    end if
    if rowHasItems(data.subscriptions) then
        content.appendChild(makeRow("Your subscriptions", data.subscriptions))
    end if
    if content.getChildCount() = 0 then
        m.homeList.visible = false
        showPairingChrome(true)
        showStatus("No playable video or audio in your subscriptions yet.")
        m.phase = "home_empty"
        return
    end if
    m.homeList.content = content
    m.phase = "home"
    showPairingChrome(false)
    m.statusLabel.text = ""
    hidePlayers()
    m.authorGrid.visible = false
    m.homeList.visible = true
    m.homeList.setFocus(true)
    hideToast()
    focusItem = 0
    if m.focusPaidTile = true then
        focusItem = 1
        m.focusPaidTile = false
    end if
    m.homeList.jumpToRowItem = [0, focusItem]
end sub

sub applyAuthor(data as object)
    playable = []
    if data <> invalid and data.posts <> invalid then
        for each item in data.posts
            if item.playable = true then
                playable.Push(item)
            end if
        end for
    end if
    m.authorPosts = playable
    content = CreateObject("roSGNode", "ContentNode")
    for each item in playable
        if shouldShowItem(item) then
            content.appendChild(makeItemNode(item))
        end if
    end for
    if playable.Count() = 0 then
        m.phase = "home"
        showPairingChrome(false)
        m.statusLabel.text = ""
        m.authorGrid.visible = false
        if m.homeList.content <> invalid then
            m.homeList.visible = true
            m.homeList.setFocus(true)
        end if
        showAlert("Nothing to play", "This publication has no Substack video or audio. Written posts and YouTube clips can't play on the TV.")
        return
    end if
    if content.getChildCount() = 0 then
        m.phase = "home"
        showPairingChrome(false)
        m.statusLabel.text = ""
        m.authorGrid.visible = false
        if m.homeList.content <> invalid then
            m.homeList.visible = true
            m.homeList.setFocus(true)
        end if
        showAlert("Paid posts hidden", "This publication only has paid-subscriber video or audio. Choose Paid: shown to see it.")
        return
    end if
    m.authorGrid.content = content
    m.phase = "author"
    m.titleLabel.text = m.authorTitle
    showPairingChrome(false)
    m.statusLabel.text = ""
    m.homeList.visible = false
    hidePlayers()
    m.authorGrid.visible = true
    m.authorGrid.setFocus(true)
end sub

sub applySearch(data as object)
    m.searchData = data
    results = invalid
    if data <> invalid then
        results = data.results
    end if
    content = CreateObject("roSGNode", "ContentNode")
    if results <> invalid then
        for each item in results
            if shouldShowItem(item) then
                content.appendChild(makeItemNode(item))
            end if
        end for
    end if
    if content.getChildCount() = 0 then
        hideToast()
        m.phase = "home"
        showPairingChrome(false)
        m.statusLabel.text = ""
        m.top.setFocus(true)
        if m.homeList.content <> invalid then
            m.homeList.visible = true
            m.homeList.setFocus(true)
        end if
        emptyMsg = "No matching video or audio in your subscriptions."
        if m.hidePaid = true then
            emptyMsg = "No matching free video or audio. Choose Paid: shown to include paid posts."
        end if
        showAlert("No results", emptyMsg)
        return
    end if
    hideToast()
    m.authorGrid.content = content
    m.phase = "search"
    showPairingChrome(false)
    m.statusLabel.text = ""
    m.homeList.visible = false
    hidePlayers()
    m.authorGrid.visible = true
    m.authorGrid.setFocus(true)
end sub

sub playMedia(play as object)
    hideBrowse()
    showPairingChrome(false)
    if LCase(play.streamFormat) = "hls" then
        m.phase = "video"
        content = CreateObject("roSGNode", "ContentNode")
        content.url = play.url
        content.title = play.title
        content.streamformat = "hls"
        m.videoPlayer.content = content
        m.videoPlayer.visible = true
        m.videoPlayer.setFocus(true)
        m.videoPlayer.control = "play"
    else
        m.phase = "audio"
        content = CreateObject("roSGNode", "ContentNode")
        content.url = play.url
        content.title = play.title
        content.streamformat = "mp3"
        m.audioUserPaused = false
        m.audioResumePos = 0
        m.audioTitle.text = play.title
        m.audioSubtitle.text = "Playing"
        m.audioChrome.visible = true
        m.audioPlayer.notificationInterval = 1
        m.audioPlayer.content = content
        m.audioPlayer.control = "play"
        m.audioChrome.setFocus(true)
    end if
end sub

sub onHomeItemSelected()
    idx = m.homeList.rowItemSelected
    if idx = invalid or idx.Count() < 2 then
        return
    end if
    rowIndex = idx[0]
    itemIndex = idx[1]
    row = m.homeList.content.getChild(rowIndex)
    item = row.getChild(itemIndex)
    if item = invalid then
        return
    end if
    if item.kind = "search" then
        openSearchKeyboard()
        return
    end if
    if item.kind = "paid_filter" then
        toggleHidePaid()
        return
    end if
    if item.kind = "publication" then
        fetchAuthor(item.publicationId, item.title)
        return
    end if
    if item.playable = true then
        fetchPlay(item.itemId)
    else
        showAlert("Can't play", "This post is not playable on TV")
    end if
end sub

sub onAuthorItemSelected()
    index = m.authorGrid.itemSelected
    item = m.authorGrid.content.getChild(index)
    if item = invalid then
        return
    end if
    if item.playable = true then
        fetchPlay(item.itemId)
    else
        showAlert("Can't play", "This post is not playable on TV")
    end if
end sub

sub onHttpResponse()
    resp = m.httpTask.response
    purpose = m.httpPurpose
    if resp = invalid then
        return
    end if
    if resp.requestId <> invalid and resp.requestId <> m.httpRequestId then
        return
    end if

    if resp.ok <> true then
        msg = httpErrorText(resp)
        if (purpose = "home" or purpose = "author" or purpose = "play" or purpose = "search") and resp.statusCode = 401 then
            showPairingChrome(true)
            showStatus(msg)
            m.registry.write("device_token", "")
            m.registry.flush()
            m.deviceToken = ""
            startPairing()
            return
        end if
        if purpose = "play" then
            showAlert("Can't play", msg)
            return
        end if
        if purpose = "search" then
            hideToast()
            m.phase = "home"
            showPairingChrome(false)
            m.statusLabel.text = ""
            m.top.setFocus(true)
            if m.homeList.content <> invalid then
                m.homeList.visible = true
                m.homeList.setFocus(true)
            end if
            showAlert("Search failed", msg)
            return
        end if
        showPairingChrome(true)
        showStatus(msg)
        return
    end if

    data = ParseJson(resp.body)
    if data = invalid then
        showStatus("Invalid JSON from server")
        return
    end if

    if purpose = "pair_start" then
        m.pairCode = data.code
        m.phase = "pair_poll"
        m.codeLabel.text = m.pairCode
        qrUrl = data.qrUrl
        if qrUrl = invalid or qrUrl = "" then
            qrUrl = m.apiBaseUrl + "/api/pair/qr.png?code=" + m.pairCode
        end if
        claimUrl = data.claimUrl
        if claimUrl = invalid or claimUrl = "" then
            claimUrl = m.apiBaseUrl + "/login?code=" + m.pairCode
        end if
        m.qrPoster.uri = qrUrl
        m.qrPoster.visible = true
        showStatus("Scan with your phone to sign in")
        m.hintLabel.text = "Or open " + claimUrl
        m.pollTimer.control = "start"
        return
    end if

    if purpose = "pair_poll" then
        if data.status = "linked" and data.deviceToken <> invalid then
            m.pollTimer.control = "stop"
            m.deviceToken = data.deviceToken
            m.registry.write("device_token", m.deviceToken)
            m.registry.write("api_base_url", m.apiBaseUrl)
            m.registry.flush()
            m.codeLabel.text = ""
            m.hintLabel.text = ""
            m.qrPoster.visible = false
            m.qrPoster.uri = ""
            fetchHome()
        else if data.status = "expired" then
            m.pollTimer.control = "stop"
            m.qrPoster.visible = false
            m.qrPoster.uri = ""
            showStatus("Pairing code expired. Press OK to retry.")
            m.phase = "pair_expired"
        end if
        return
    end if

    if purpose = "home" then
        applyHome(data)
        return
    end if

    if purpose = "author" then
        applyAuthor(data)
        return
    end if

    if purpose = "search" then
        applySearch(data)
        return
    end if

    if purpose = "play" then
        playMedia(data)
    end if
end sub

sub onVideoState()
    state = m.videoPlayer.state
    if state = "error" or state = "finished" then
        m.videoPlayer.visible = false
        showBrowseAfterPlay()
    end if
end sub

sub onAudioState()
    if m.phase <> "audio" then
        return
    end if
    state = m.audioPlayer.state
    if m.audioUserPaused = true then
        if state = "paused" or state = "stopped" or state = "error" or state = "finished" then
            m.audioSubtitle.text = "Paused"
            return
        end if
    end if
    if state = "playing" then
        m.audioSubtitle.text = audioStatusText("Playing")
        return
    end if
    if state = "paused" then
        m.audioSubtitle.text = audioStatusText("Paused")
        return
    end if
    if state = "error" or state = "finished" then
        m.audioChrome.visible = false
        m.audioUserPaused = false
        showBrowseAfterPlay()
    end if
end sub

sub onAudioPosition()
    if m.phase <> "audio" then
        return
    end if
    if m.audioUserPaused = true then
        m.audioSubtitle.text = audioStatusText("Paused")
        return
    end if
    if m.audioPlayer.state = "playing" then
        m.audioSubtitle.text = audioStatusText("Playing")
    end if
end sub

function audioStatusText(prefix as string) as string
    playhead = m.audioPlayer.position
    length = m.audioPlayer.duration
    if playhead = invalid or playhead < 0 then
        return prefix
    end if
    if length = invalid or length <= 0 then
        return prefix + "  " + formatClock(playhead)
    end if
    return prefix + "  " + formatClock(playhead) + " / " + formatClock(length)
end function

function formatClock(seconds) as string
    total = Int(seconds + 0.5)
    if total < 0 then
        total = 0
    end if
    hours = Int(total / 3600)
    mins = Int((total MOD 3600) / 60)
    secs = total MOD 60
    if hours > 0 then
        return StrI(hours).Trim() + ":" + pad2(mins) + ":" + pad2(secs)
    end if
    return StrI(mins).Trim() + ":" + pad2(secs)
end function

function pad2(n) as string
    value = Int(n)
    if value < 10 then
        return "0" + StrI(value).Trim()
    end if
    return StrI(value).Trim()
end function

sub toggleAudioPause()
    state = m.audioPlayer.state
    if m.audioUserPaused = true then
        resumeAudio()
        return
    end if
    if state = "playing" or state = "buffering" then
        playhead = m.audioPlayer.position
        if playhead <> invalid and playhead > 0 then
            m.audioResumePos = playhead
        end if
        m.audioUserPaused = true
        m.audioPlayer.control = "pause"
        m.audioSubtitle.text = audioStatusText("Paused")
    else
        resumeAudio()
    end if
end sub

sub resumeAudio()
    m.audioUserPaused = false
    state = m.audioPlayer.state
    if state = "paused" then
        m.audioPlayer.control = "resume"
    else
        m.audioPlayer.control = "play"
        if m.audioResumePos > 0 then
            m.audioPlayer.seek = m.audioResumePos
        end if
    end if
    m.audioSubtitle.text = audioStatusText("Playing")
end sub

sub seekAudio(delta)
    playhead = m.audioPlayer.position
    if playhead = invalid or playhead < 0 then
        playhead = 0
    end if
    target = playhead + delta
    if target < 0 then
        target = 0
    end if
    dur = m.audioPlayer.duration
    if dur <> invalid and dur > 0 and target > dur - 1 then
        target = dur - 1
    end if
    m.audioResumePos = target
    m.audioPlayer.seek = target
    if m.audioUserPaused = true then
        m.audioSubtitle.text = audioStatusText("Paused")
    else
        m.audioSubtitle.text = audioStatusText("Playing")
    end if
end sub

sub showBrowseAfterPlay()
    if m.returnPhase = "search" and m.searchData <> invalid then
        applySearch(m.searchData)
        return
    end if
    if m.returnPhase = "author" and m.authorPosts <> invalid then
        authorData = {}
        authorData.posts = m.authorPosts
        applyAuthor(authorData)
        return
    end if
    if m.homeList.content <> invalid then
        m.phase = "home"
        m.homeList.visible = true
        m.homeList.setFocus(true)
        return
    end if
    fetchHome()
end sub

function httpErrorText(resp as object) as string
    if resp = invalid then
        return "Request failed"
    end if
    data = invalid
    if resp.body <> invalid and resp.body <> "" then
        data = ParseJson(resp.body)
    end if
    if data <> invalid and data.error <> invalid and data.error <> "" then
        return friendlyErrorMessage(data.error)
    end if
    if resp.body <> invalid and resp.body <> "" then
        return friendlyErrorMessage(resp.body)
    end if
    return "Request failed"
end function

function friendlyErrorMessage(text as string) as string
    lowered = LCase(text)
    if Instr(1, lowered, "paid subscriber") > 0 then
        return "This video is for paid subscribers only"
    end if
    return text
end function

sub showAlert(title as string, message as string)
    closeTopDialog()
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = title
    dialog.message = [message]
    dialog.buttons = ["OK"]
    dialog.observeField("buttonSelected", "onAlertButton")
    dialog.observeField("wasClosed", "onAlertClosed")
    m.alertDialog = dialog
    m.alertSettled = false
    m.top.dialog = dialog
end sub

sub onAlertButton()
    dialog = m.alertDialog
    if dialog = invalid then
        return
    end if
    dialog.close = true
end sub

sub onAlertClosed()
    finishAlertDialog()
end sub

sub finishAlertDialog()
    if m.alertSettled = true then
        return
    end if
    m.alertSettled = true
    m.top.dialog = invalid
    m.alertDialog = invalid
    m.top.setFocus(true)
    restoreBrowseFocus()
end sub

sub ensureSearchKeyboard()
    if m.searchKeyboard <> invalid then
        return
    end if
    if m.searchOverlay = invalid then
        return
    end if
    kb = CreateObject("roSGNode", "Keyboard")
    if kb = invalid then
        return
    end if
    kb.id = "searchKeyboard"
    kb.translation = [360, 200]
    m.searchOverlay.appendChild(kb)
    m.searchKeyboard = kb
    editNode = kb.getField("textEditBox")
    if editNode <> invalid then
        editNode.setField("voiceEnabled", true)
    end if
end sub

sub openSearchKeyboard()
    closeTopDialog()
    ensureSearchKeyboard()
    if m.searchOverlay = invalid or m.searchKeyboard = invalid then
        return
    end if
    m.searchReturnPhase = m.phase
    m.phase = "search_input"
    m.searchKeyboard.text = ""
    showPairingChrome(false)
    m.searchOverlay.visible = true
    m.searchKeyboard.setFocus(true)
end sub

sub closeSearchOverlay()
    if m.searchOverlay <> invalid then
        m.searchOverlay.visible = false
    end if
    if m.phase = "search_input" then
        if m.searchReturnPhase <> invalid and m.searchReturnPhase <> "" then
            m.phase = m.searchReturnPhase
        else
            m.phase = "home"
        end if
    end if
end sub

function searchOverlayOpen() as boolean
    if m.searchOverlay = invalid then
        return false
    end if
    if m.searchOverlay.visible = true then
        return true
    end if
    return false
end function

sub submitSearchFromOverlay()
    query = ""
    if m.searchKeyboard <> invalid then
        raw = m.searchKeyboard.text
        if raw <> invalid then
            query = raw.Trim()
        end if
    end if
    closeSearchOverlay()
    m.top.setFocus(true)
    if query = "" then
        restoreBrowseFocus()
        return
    end if
    fetchSearch(query)
end sub

sub closeTopDialog()
    m.top.dialog = invalid
    m.alertDialog = invalid
    m.searchDialog = invalid
    m.alertSettled = true
    m.searchDialogSettled = true
end sub

sub restoreBrowseFocus()
    m.top.setFocus(true)
    if m.phase = "search" and m.authorGrid.visible = true then
        m.authorGrid.setFocus(true)
        return
    end if
    if m.phase = "author" and m.authorGrid.visible = true then
        m.authorGrid.setFocus(true)
        return
    end if
    if m.homeList.visible = true then
        m.homeList.setFocus(true)
        return
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then
        return false
    end if

    if searchOverlayOpen() then
        if key = "back" then
            closeSearchOverlay()
            restoreBrowseFocus()
            return true
        end if
        if key = "play" or key = "replay" then
            submitSearchFromOverlay()
            return true
        end if
        return false
    end if

    if key = "back" then
        if m.phase = "video" or m.phase = "audio" then
            hidePlayers()
            showBrowseAfterPlay()
            return true
        end if
        if m.phase = "author" or m.phase = "author_load" or m.phase = "search" or m.phase = "search_load" then
            m.httpRequestId = m.httpRequestId + 1
            m.httpPurpose = ""
            hideToast()
            m.authorGrid.visible = false
            m.titleLabel.text = "Roku Substack"
            m.searchQuery = ""
            applyHome(m.homeData)
            return true
        end if
    end if

    if key = "OK" or key = "play" or key = "pause" then
        if m.phase = "pair_expired" then
            startPairing()
            return true
        end if
        if m.phase = "audio" then
            toggleAudioPause()
            return true
        end if
    end if

    if m.phase = "audio" then
        if key = "right" or key = "fastforward" then
            skip = 15
            if key = "fastforward" then
                skip = 30
            end if
            seekAudio(skip)
            return true
        end if
        if key = "left" or key = "rewind" then
            skip = 15
            if key = "rewind" then
                skip = 30
            end if
            seekAudio(-skip)
            return true
        end if
        if key = "replay" then
            seekAudio(-10)
            return true
        end if
    end if

    if key = "search" then
        if m.phase = "home" or m.phase = "home_empty" or m.phase = "author" or m.phase = "search" then
            openSearchKeyboard()
            return true
        end if
    end if

    if key = "options" then
        m.pollTimer.control = "stop"
        m.registry.write("device_token", "")
        m.registry.write("api_base_url", "")
        m.registry.flush()
        m.apiBaseUrl = resolveApiBaseUrl()
        m.deviceToken = ""
        hidePlayers()
        hideBrowse()
        startPairing()
        return true
    end if

    return false
end function
