param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText($Zip, [string]$EntryPath) {
  $entry = $Zip.GetEntry($EntryPath)
  if ($null -eq $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Xml-With-Namespace([string]$Text, [string]$Prefix, [string]$Namespace) {
  $xml = New-Object System.Xml.XmlDocument
  $xml.PreserveWhitespace = $false
  $xml.LoadXml($Text)
  $manager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $manager.AddNamespace($Prefix, $Namespace)
  return @($xml, $manager)
}

function Cell-Value($Cell, $SharedStrings, $Ns) {
  $type = $Cell.GetAttribute('t')
  $valueNode = $Cell.SelectSingleNode('m:v', $Ns)
  $inlineNode = $Cell.SelectSingleNode('m:is', $Ns)
  $raw = if ($null -ne $valueNode) { $valueNode.InnerText } else { $null }
  switch ($type) {
    's' {
      if ($null -ne $raw -and [int]$raw -lt $SharedStrings.Count) { return $SharedStrings[[int]$raw] }
      return $raw
    }
    'inlineStr' {
      if ($null -eq $inlineNode) { return '' }
      return (($inlineNode.SelectNodes('.//m:t', $Ns) | ForEach-Object { $_.InnerText }) -join '')
    }
    'b' { return ($raw -eq '1') }
    'e' { return $raw }
    'str' { return $raw }
    default {
      if ($null -eq $raw -or $raw -eq '') { return $null }
      $number = 0.0
      if ([double]::TryParse($raw, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $number }
      return $raw
    }
  }
}

$fileStream = [System.IO.File]::Open(
  $InputPath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::ReadWrite
)
$zip = New-Object System.IO.Compression.ZipArchive(
  $fileStream,
  [System.IO.Compression.ZipArchiveMode]::Read,
  $false
)
try {
  $mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  $officeRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  $packageRelNs = 'http://schemas.openxmlformats.org/package/2006/relationships'

  $workbookPair = Xml-With-Namespace (Read-ZipText $zip 'xl/workbook.xml') 'm' $mainNs
  $workbookXml = $workbookPair[0]
  $workbookNs = $workbookPair[1]
  $workbookNs.AddNamespace('r', $officeRelNs)

  $relsPair = Xml-With-Namespace (Read-ZipText $zip 'xl/_rels/workbook.xml.rels') 'p' $packageRelNs
  $relsXml = $relsPair[0]
  $relsNs = $relsPair[1]
  $relationshipTargets = @{}
  foreach ($relationship in $relsXml.SelectNodes('//p:Relationship', $relsNs)) {
    $relationshipTargets[$relationship.GetAttribute('Id')] = $relationship.GetAttribute('Target')
  }

  $sharedStrings = @()
  $sharedText = Read-ZipText $zip 'xl/sharedStrings.xml'
  if ($null -ne $sharedText) {
    $sharedPair = Xml-With-Namespace $sharedText 'm' $mainNs
    foreach ($item in $sharedPair[0].SelectNodes('//m:si', $sharedPair[1])) {
      $sharedStrings += (($item.SelectNodes('.//m:t', $sharedPair[1]) | ForEach-Object { $_.InnerText }) -join '')
    }
  }

  $styleFormats = @{}
  $differentialFormats = @()
  $stylesText = Read-ZipText $zip 'xl/styles.xml'
  if ($null -ne $stylesText) {
    $stylesPair = Xml-With-Namespace $stylesText 'm' $mainNs
    $customFormats = @{}
    foreach ($format in $stylesPair[0].SelectNodes('//m:numFmts/m:numFmt', $stylesPair[1])) {
      $customFormats[$format.GetAttribute('numFmtId')] = $format.GetAttribute('formatCode')
    }
    $builtInFormats = @{
      '0'='General'; '1'='0'; '2'='0.00'; '3'='#,##0'; '4'='#,##0.00';
      '9'='0%'; '10'='0.00%'; '14'='mm-dd-yy'; '20'='h:mm'; '21'='h:mm:ss'; '22'='m/d/yy h:mm'
    }
    $styleIndex = 0
    foreach ($xf in $stylesPair[0].SelectNodes('//m:cellXfs/m:xf', $stylesPair[1])) {
      $formatId = $xf.GetAttribute('numFmtId')
      $formatCode = if ($customFormats.ContainsKey($formatId)) { $customFormats[$formatId] } elseif ($builtInFormats.ContainsKey($formatId)) { $builtInFormats[$formatId] } else { $null }
      $styleFormats[[string]$styleIndex] = [ordered]@{ numFmtId = $formatId; formatCode = $formatCode }
      $styleIndex++
    }
    foreach ($dxf in $stylesPair[0].SelectNodes('//m:dxfs/m:dxf', $stylesPair[1])) {
      $fontColor = $dxf.SelectSingleNode('m:font/m:color', $stylesPair[1])
      $fillColor = $dxf.SelectSingleNode('m:fill/m:patternFill/m:fgColor', $stylesPair[1])
      $differentialFormats += [ordered]@{
        fontColorRgb = if ($null -ne $fontColor) { $fontColor.GetAttribute('rgb') } else { $null }
        fontColorIndexed = if ($null -ne $fontColor) { $fontColor.GetAttribute('indexed') } else { $null }
        fillColorRgb = if ($null -ne $fillColor) { $fillColor.GetAttribute('rgb') } else { $null }
        fillColorIndexed = if ($null -ne $fillColor) { $fillColor.GetAttribute('indexed') } else { $null }
      }
    }
  }

  $result = [ordered]@{
    file = $InputPath
    workbook = [ordered]@{
      sheets = @()
      definedNames = @()
      calculation = @{}
    }
    styles = [ordered]@{
      differentialFormats = $differentialFormats
    }
    worksheets = @()
    charts = @()
    packageEntries = @($zip.Entries | ForEach-Object { $_.FullName })
  }

  foreach ($definedName in $workbookXml.SelectNodes('//m:definedNames/m:definedName', $workbookNs)) {
    $result.workbook.definedNames += [ordered]@{
      name = $definedName.GetAttribute('name')
      localSheetId = $definedName.GetAttribute('localSheetId')
      hidden = $definedName.GetAttribute('hidden')
      formula = $definedName.InnerText
    }
  }

  $calc = $workbookXml.SelectSingleNode('//m:calcPr', $workbookNs)
  if ($null -ne $calc) {
    foreach ($attribute in $calc.Attributes) { $result.workbook.calculation[$attribute.Name] = $attribute.Value }
  }

  foreach ($sheetNode in $workbookXml.SelectNodes('//m:sheets/m:sheet', $workbookNs)) {
    $sheetName = $sheetNode.GetAttribute('name')
    $relationshipId = $sheetNode.GetAttribute('id', $officeRelNs)
    $target = $relationshipTargets[$relationshipId]
    $sheetPath = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target.Replace('../', '') }
    $sheetPath = $sheetPath.Replace('\', '/')

    $result.workbook.sheets += [ordered]@{
      name = $sheetName
      sheetId = $sheetNode.GetAttribute('sheetId')
      state = $sheetNode.GetAttribute('state')
      relationshipId = $relationshipId
      path = $sheetPath
    }

    $sheetText = Read-ZipText $zip $sheetPath
    if ($null -eq $sheetText) { continue }
    $sheetPair = Xml-With-Namespace $sheetText 'm' $mainNs
    $sheetXml = $sheetPair[0]
    $sheetNs = $sheetPair[1]
    $sheetNs.AddNamespace('r', $officeRelNs)

    $sheetResult = [ordered]@{
      name = $sheetName
      path = $sheetPath
      dimension = $sheetXml.SelectSingleNode('//m:dimension', $sheetNs).GetAttribute('ref')
      protection = @{}
      cells = @()
      formulas = @()
      mergedRanges = @()
      validations = @()
      conditionalFormats = @()
      hyperlinks = @()
      drawingRelationshipId = $null
    }

    $protection = $sheetXml.SelectSingleNode('//m:sheetProtection', $sheetNs)
    if ($null -ne $protection) {
      foreach ($attribute in $protection.Attributes) { $sheetResult.protection[$attribute.Name] = $attribute.Value }
    }

    foreach ($cell in $sheetXml.SelectNodes('//m:sheetData/m:row/m:c', $sheetNs)) {
      $formulaNode = $cell.SelectSingleNode('m:f', $sheetNs)
      $styleIndex = $cell.GetAttribute('s')
      $cellData = [ordered]@{
        address = $cell.GetAttribute('r')
        type = $cell.GetAttribute('t')
        styleIndex = $styleIndex
        numberFormat = if ($styleFormats.ContainsKey($styleIndex)) { $styleFormats[$styleIndex] } else { $null }
        value = Cell-Value $cell $sharedStrings $sheetNs
        formula = if ($null -ne $formulaNode) { $formulaNode.InnerText } else { $null }
        formulaType = if ($null -ne $formulaNode) { $formulaNode.GetAttribute('t') } else { $null }
        formulaRef = if ($null -ne $formulaNode) { $formulaNode.GetAttribute('ref') } else { $null }
        sharedIndex = if ($null -ne $formulaNode) { $formulaNode.GetAttribute('si') } else { $null }
      }
      $sheetResult.cells += $cellData
      if ($null -ne $formulaNode) { $sheetResult.formulas += $cellData }
    }

    foreach ($merge in $sheetXml.SelectNodes('//m:mergeCells/m:mergeCell', $sheetNs)) {
      $sheetResult.mergedRanges += $merge.GetAttribute('ref')
    }

    foreach ($validation in $sheetXml.SelectNodes('//m:dataValidations/m:dataValidation', $sheetNs)) {
      $sheetResult.validations += [ordered]@{
        sqref = $validation.GetAttribute('sqref')
        type = $validation.GetAttribute('type')
        operator = $validation.GetAttribute('operator')
        allowBlank = $validation.GetAttribute('allowBlank')
        showErrorMessage = $validation.GetAttribute('showErrorMessage')
        formula1 = ($validation.SelectSingleNode('m:formula1', $sheetNs)).InnerText
        formula2 = ($validation.SelectSingleNode('m:formula2', $sheetNs)).InnerText
      }
    }

    foreach ($conditional in $sheetXml.SelectNodes('//m:conditionalFormatting', $sheetNs)) {
      foreach ($rule in $conditional.SelectNodes('m:cfRule', $sheetNs)) {
        $sheetResult.conditionalFormats += [ordered]@{
          sqref = $conditional.GetAttribute('sqref')
          type = $rule.GetAttribute('type')
          operator = $rule.GetAttribute('operator')
          priority = $rule.GetAttribute('priority')
          dxfId = $rule.GetAttribute('dxfId')
          stopIfTrue = $rule.GetAttribute('stopIfTrue')
          formulas = @($rule.SelectNodes('m:formula', $sheetNs) | ForEach-Object { $_.InnerText })
        }
      }
    }

    foreach ($hyperlink in $sheetXml.SelectNodes('//m:hyperlinks/m:hyperlink', $sheetNs)) {
      $sheetResult.hyperlinks += [ordered]@{
        ref = $hyperlink.GetAttribute('ref')
        relationshipId = $hyperlink.GetAttribute('id', $officeRelNs)
        location = $hyperlink.GetAttribute('location')
        display = $hyperlink.GetAttribute('display')
      }
    }

    $drawing = $sheetXml.SelectSingleNode('//m:drawing', $sheetNs)
    if ($null -ne $drawing) { $sheetResult.drawingRelationshipId = $drawing.GetAttribute('id', $officeRelNs) }
    $result.worksheets += $sheetResult
  }

  foreach ($chartEntry in $zip.Entries | Where-Object { $_.FullName -match '^xl/charts/chart\d+\.xml$' }) {
    $chartText = Read-ZipText $zip $chartEntry.FullName
    $chartPair = Xml-With-Namespace $chartText 'c' 'http://schemas.openxmlformats.org/drawingml/2006/chart'
    $chartPair[1].AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $chartSeries = @()
    foreach ($series in $chartPair[0].SelectNodes('//c:ser', $chartPair[1])) {
      $chartSeries += [ordered]@{
        index = ($series.SelectSingleNode('c:idx', $chartPair[1])).GetAttribute('val')
        order = ($series.SelectSingleNode('c:order', $chartPair[1])).GetAttribute('val')
        nameFormula = ($series.SelectSingleNode('c:tx/c:strRef/c:f', $chartPair[1])).InnerText
        nameValue = ($series.SelectSingleNode('c:tx/c:v', $chartPair[1])).InnerText
        categoryFormula = ($series.SelectSingleNode('c:cat//c:f', $chartPair[1])).InnerText
        valueFormula = ($series.SelectSingleNode('c:val//c:f', $chartPair[1])).InnerText
      }
    }
    $result.charts += [ordered]@{
      path = $chartEntry.FullName
      title = (($chartPair[0].SelectNodes('//c:title//a:t', $chartPair[1]) | ForEach-Object { $_.InnerText }) -join '')
      series = $chartSeries
    }
  }

  $json = $result | ConvertTo-Json -Depth 16
  [System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))
  Write-Output $OutputPath
}
finally {
  $zip.Dispose()
  $fileStream.Dispose()
}
