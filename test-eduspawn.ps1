param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Email = "test@eduspawn.com",
    [string]$Password = "StrongPass123",

    [string]$Topic = "Black holes",
    [string]$CuriosityPrompt = "Bir kara delik zamani nasil bukebilir?",

    [ValidateSet("short_video_script", "carousel_post", "narration", "image_prompt")]
    [string]$OutputType = "short_video_script",

    [ValidateSet("free", "pro", "premium")]
    [string]$PlanTier = "free",

    [string]$PreferredTone = "cinematic",
    [string]$PreferredDifficulty = "beginner",
    [string[]]$FavoriteTopics = @("space", "psychology"),
    [string]$Language = "tr",

    [switch]$SkipDna,
    [switch]$SkipOutput,
    [switch]$VerboseJson
)

$ErrorActionPreference = "Stop"

function Step($message) {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor DarkGray
    Write-Host $message -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor DarkGray
}

function Print-Json($label, $obj, [int]$Depth = 8) {
    if ($VerboseJson) {
        Write-Host ""
        Write-Host "[$label]" -ForegroundColor Yellow
        $obj | ConvertTo-Json -Depth $Depth | Write-Host
    }
}

function Safe-ServerMessage($exception) {
    if ($exception.ErrorDetails -and $exception.ErrorDetails.Message) {
        return $exception.ErrorDetails.Message
    }
    return $null
}

try {
    Step "1) LOGIN"

    $loginBody = @{
        email    = $Email
        password = $Password
    } | ConvertTo-Json

    $login = Invoke-RestMethod -Method POST `
        -Uri "$BaseUrl/auth/login" `
        -ContentType "application/json" `
        -Body $loginBody

    $token = $login.data.token

    if (-not $token) {
        throw "Login succeeded but token is empty."
    }

    $AuthHeaders = @{
        Authorization = "Bearer $token"
    }

    Write-Host "Login OK" -ForegroundColor Green
    Print-Json "LOGIN RESPONSE" $login

    if (-not $SkipDna) {
        Step "2) UPSERT DNA"

        $dnaBody = @{
            preferredTone       = $PreferredTone
            preferredDifficulty = $PreferredDifficulty
            favoriteTopics      = $FavoriteTopics
            language            = $Language
        } | ConvertTo-Json -Depth 6

        $dna = Invoke-RestMethod -Method POST `
            -Uri "$BaseUrl/core/dna" `
            -Headers $AuthHeaders `
            -ContentType "application/json" `
            -Body $dnaBody

        Write-Host "DNA upsert OK" -ForegroundColor Green
        Print-Json "DNA RESPONSE" $dna
    }

    Step "3) CREATE SESSION"

    $sessionBody = @{
        topic           = $Topic
        curiosityPrompt = $CuriosityPrompt
    } | ConvertTo-Json -Depth 6

    $session = Invoke-RestMethod -Method POST `
        -Uri "$BaseUrl/core/sessions" `
        -Headers $AuthHeaders `
        -ContentType "application/json" `
        -Body $sessionBody

    $sessionId = $session.data.session.id

    if (-not $sessionId) {
        throw "Session created but sessionId is empty."
    }

    Write-Host "Session created OK" -ForegroundColor Green
    Write-Host "Session ID: $sessionId" -ForegroundColor Yellow
    Print-Json "SESSION RESPONSE" $session

    Step "4) GENERATE LESSON"

    $generate = Invoke-RestMethod -Method POST `
        -Uri "$BaseUrl/core/sessions/$sessionId/generate" `
        -Headers $AuthHeaders

    Write-Host "Lesson generation OK" -ForegroundColor Green
    Print-Json "GENERATE RESPONSE" $generate

    Step "5) GET SESSION"

    $sessionDetails = Invoke-RestMethod -Method GET `
        -Uri "$BaseUrl/core/sessions/$sessionId" `
        -Headers $AuthHeaders

    Write-Host "Session fetch OK" -ForegroundColor Green
    Print-Json "SESSION DETAILS" $sessionDetails

    if (-not $SkipOutput) {
        Step "6) CREATE CONTENT OUTPUT"

        $outputBody = @{
            outputType = $OutputType
        } | ConvertTo-Json -Depth 6

        $output = Invoke-RestMethod -Method POST `
            -Uri "$BaseUrl/core/sessions/$sessionId/output" `
            -Headers $AuthHeaders `
            -ContentType "application/json" `
            -Body $outputBody

        Write-Host "Content output OK" -ForegroundColor Green
        Print-Json "OUTPUT RESPONSE" $output

        Step "7) LIST CONTENT OUTPUTS"

        $outputs = Invoke-RestMethod -Method GET `
            -Uri "$BaseUrl/core/sessions/$sessionId/outputs" `
            -Headers $AuthHeaders

        Write-Host "Outputs list OK" -ForegroundColor Green
        Print-Json "OUTPUTS RESPONSE" $outputs
    }

    Step "SUMMARY"

    $summary = [PSCustomObject]@{
        baseUrl         = $BaseUrl
        email           = $Email
        topic           = $Topic
        curiosityPrompt = $CuriosityPrompt
        outputType      = $OutputType
        planTier        = $PlanTier
        sessionId       = $sessionId
        status          = "passed"
    }

    $summary | ConvertTo-Json -Depth 5 | Write-Host

    Step "ALL TESTS PASSED"
    Write-Host "EduSpawn end-to-end flow is working." -ForegroundColor Green
}
catch {
    Step "TEST FAILED"

    Write-Host $_.Exception.Message -ForegroundColor Red

    $serverMessage = Safe-ServerMessage $_
    if ($serverMessage) {
        Write-Host ""
        Write-Host "Server response:" -ForegroundColor Yellow
        Write-Host $serverMessage -ForegroundColor DarkYellow
    }

    exit 1
}