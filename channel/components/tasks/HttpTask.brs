sub init()
    m.top.functionName = "exec"
end sub

sub exec()
    result = {
        ok: false,
        statusCode: 0,
        body: "",
        requestId: m.top.requestId
    }

    url = m.top.url
    if url = invalid or url = "" then
        result.body = "Missing URL"
        m.top.response = result
        return
    end if

    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetMessagePort(port)
    xfer.SetUrl(url)
    xfer.RetainBodyOnError(true)
    xfer.EnableEncodings(true)

    if Left(LCase(url), 8) = "https://" then
        xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
        xfer.InitClientCertificates()
    end if

    headers = m.top.headers
    if headers <> invalid then
        for each h in headers
            colon = Instr(1, h, ":")
            if colon > 0 then
                name = Left(h, colon - 1).Trim()
                value = Mid(h, colon + 1).Trim()
                xfer.AddHeader(name, value)
            end if
        end for
    end if

    method = UCase(m.top.method)
    sent = false
    if method = "POST" then
        body = m.top.body
        if body = invalid then body = ""
        sent = xfer.AsyncPostFromString(body)
    else
        sent = xfer.AsyncGetToString()
    end if

    if not sent then
        result.body = "Failed to start request"
        m.top.response = result
        return
    end if

    while true
        msg = wait(30000, port)
        if type(msg) = "roUrlEvent" then
            code = msg.GetResponseCode()
            result.statusCode = code
            result.body = msg.GetString()
            result.ok = (code >= 200 and code < 300)
            exit while
        else if msg = invalid then
            result.body = "Request timed out"
            xfer.AsyncCancel()
            exit while
        end if
    end while

    m.top.response = result
end sub
