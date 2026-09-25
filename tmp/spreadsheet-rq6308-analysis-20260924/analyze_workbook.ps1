param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null

function Safe-Value([scriptblock]$Getter) {
  try { return & $Getter } catch { return $null }
}

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  try { $excel.AutomationSecurity = 3 } catch {}

  $workbook = $excel.Workbooks.Open($InputPath, 0, $true)

  $result = [ordered]@{
    file = $InputPath
    workbook = [ordered]@{
      name = $workbook.Name
      fullName = $workbook.FullName
      readOnly = $workbook.ReadOnly
      date1904 = $workbook.Date1904
      calculationVersion = $workbook.CalculationVersion
      hasVBProject = Safe-Value { $workbook.HasVBProject }
      protectStructure = $workbook.ProtectStructure
      names = @()
    }
    worksheets = @()
  }

  foreach ($name in $workbook.Names) {
    $result.workbook.names += [ordered]@{
      name = $name.Name
      refersTo = $name.RefersTo
      visible = $name.Visible
    }
  }

  foreach ($sheet in $workbook.Worksheets) {
    $used = $sheet.UsedRange
    $sheetResult = [ordered]@{
      name = $sheet.Name
      index = $sheet.Index
      visible = $sheet.Visible
      usedRange = $used.Address($false, $false, 1)
      rows = $used.Rows.Count
      columns = $used.Columns.Count
      protectContents = $sheet.ProtectContents
      protectDrawingObjects = $sheet.ProtectDrawingObjects
      cells = @()
      formulas = @()
      mergedRanges = @()
      validations = @()
      conditionalFormats = @()
      shapes = @()
      charts = @()
    }

    $mergeSeen = @{}
    $validationSeen = @{}

    for ($row = 1; $row -le $used.Rows.Count; $row++) {
      for ($column = 1; $column -le $used.Columns.Count; $column++) {
        $cell = $used.Cells.Item($row, $column)
        $address = $cell.Address($false, $false, 1)
        $hasFormula = [bool]$cell.HasFormula
        $value = $cell.Value2
        $text = [string]$cell.Text

        if ($hasFormula -or $null -ne $value -or $text -ne '') {
          $cellData = [ordered]@{
            address = $address
            value = $value
            text = $text
            formula = if ($hasFormula) { [string]$cell.Formula } else { $null }
            formulaLocal = if ($hasFormula) { [string]$cell.FormulaLocal } else { $null }
            numberFormat = [string]$cell.NumberFormat
            numberFormatLocal = [string]$cell.NumberFormatLocal
            locked = [bool]$cell.Locked
          }
          $sheetResult.cells += $cellData
          if ($hasFormula) { $sheetResult.formulas += $cellData }
        }

        if ([bool]$cell.MergeCells) {
          $mergeAddress = $cell.MergeArea.Address($false, $false, 1)
          if (-not $mergeSeen.ContainsKey($mergeAddress)) {
            $mergeSeen[$mergeAddress] = $true
            $sheetResult.mergedRanges += $mergeAddress
          }
        }

        try {
          $validationType = $cell.Validation.Type
          $validationKey = "$address|$validationType|$($cell.Validation.Formula1)|$($cell.Validation.Formula2)"
          if (-not $validationSeen.ContainsKey($validationKey)) {
            $validationSeen[$validationKey] = $true
            $sheetResult.validations += [ordered]@{
              address = $address
              type = $validationType
              operator = Safe-Value { $cell.Validation.Operator }
              formula1 = Safe-Value { [string]$cell.Validation.Formula1 }
              formula2 = Safe-Value { [string]$cell.Validation.Formula2 }
              ignoreBlank = Safe-Value { [bool]$cell.Validation.IgnoreBlank }
              inCellDropdown = Safe-Value { [bool]$cell.Validation.InCellDropdown }
            }
          }
        } catch {}
      }
    }

    for ($i = 1; $i -le $used.FormatConditions.Count; $i++) {
      $condition = $used.FormatConditions.Item($i)
      $sheetResult.conditionalFormats += [ordered]@{
        appliesTo = Safe-Value { $condition.AppliesTo.Address($false, $false, 1) }
        type = Safe-Value { $condition.Type }
        operator = Safe-Value { $condition.Operator }
        formula1 = Safe-Value { [string]$condition.Formula1 }
        formula2 = Safe-Value { [string]$condition.Formula2 }
        stopIfTrue = Safe-Value { [bool]$condition.StopIfTrue }
        interiorColor = Safe-Value { $condition.Interior.Color }
        fontColor = Safe-Value { $condition.Font.Color }
      }
    }

    foreach ($shape in $sheet.Shapes) {
      $sheetResult.shapes += [ordered]@{
        name = $shape.Name
        type = $shape.Type
        onAction = Safe-Value { [string]$shape.OnAction }
        alternativeText = Safe-Value { [string]$shape.AlternativeText }
        text = Safe-Value { [string]$shape.TextFrame2.TextRange.Text }
      }
    }

    foreach ($chartObject in $sheet.ChartObjects()) {
      $chart = $chartObject.Chart
      $series = @()
      foreach ($item in $chart.SeriesCollection()) {
        $series += [ordered]@{
          name = Safe-Value { [string]$item.Name }
          formula = Safe-Value { [string]$item.Formula }
          formulaLocal = Safe-Value { [string]$item.FormulaLocal }
        }
      }
      $sheetResult.charts += [ordered]@{
        name = $chartObject.Name
        chartType = $chart.ChartType
        title = if ($chart.HasTitle) { [string]$chart.ChartTitle.Text } else { '' }
        series = $series
      }
    }

    $result.worksheets += $sheetResult
  }

  $json = $result | ConvertTo-Json -Depth 14
  [System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))
  Write-Output $OutputPath
}
finally {
  if ($null -ne $workbook) {
    try { $workbook.Close($false) } catch {}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)
  }
  if ($null -ne $excel) {
    try { $excel.Quit() } catch {}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
