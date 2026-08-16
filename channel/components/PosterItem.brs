sub init()
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.focusRing = m.top.findNode("focusRing")
    m.placeholder = m.top.findNode("placeholder")
    applyFocus()
end sub

sub onWidthChange()
    w = m.top.width
    if w > 0 then
        m.focusRing.width = w
        m.poster.width = w - 16
        m.title.width = w - 16
        if m.placeholder <> invalid then
            m.placeholder.width = w - 16
        end if
    end if
end sub

sub onHeightChange()
    h = m.top.height
    if h > 40 then
        posterH = h - 48
        m.focusRing.height = posterH + 16
        m.poster.height = posterH
        m.title.translation = [8, posterH + 20]
        if m.placeholder <> invalid then
            m.placeholder.height = posterH
        end if
    end if
end sub

sub onContentChange()
    item = m.top.itemContent
    if item = invalid then
        return
    end if
    m.title.text = item.title
    poster = item.HDPosterUrl
    if poster = invalid or poster = "" then
        poster = item.hdposterurl
    end if
    if poster <> invalid and poster <> "" then
        m.poster.uri = poster
        m.poster.visible = true
        if m.placeholder <> invalid then
            m.placeholder.color = "0x1E2430FF"
        end if
    else
        m.poster.uri = ""
        m.poster.visible = false
        if m.placeholder <> invalid then
            if item.kind = "search" then
                m.placeholder.color = "0xFF6719FF"
            else
                m.placeholder.color = "0x1E2430FF"
            end if
        end if
    end if
end sub

sub onFocusChange()
    applyFocus()
end sub

sub applyFocus()
    focused = false
    if m.top.itemHasFocus = true then
        focused = true
    end if
    if m.top.focusPercent <> invalid and m.top.focusPercent > 0.5 then
        focused = true
    end if
    if focused then
        m.focusRing.opacity = 1
        m.poster.opacity = 1
        m.title.color = "0xFF6719FF"
    else
        m.focusRing.opacity = 0
        m.poster.opacity = 0.8
        m.title.color = "0xC8CDD4FF"
    end if
end sub
