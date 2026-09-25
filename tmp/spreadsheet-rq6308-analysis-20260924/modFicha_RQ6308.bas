Attribute VB_Name = "modFicha"
Option Explicit

' ---------------------------------------------------------------
' RQ 6308 REV 03 - Ficha de controle em processo de volume
' Macros dos botoes IMPRIMIR / SALVAR COMO... / NOVA FICHA EM BRANCO
'
' As macros sempre trabalham sobre a ficha (aba) que esta ativa,
' entao funcionam igual nas copias geradas pelo botao NOVA FICHA.
'
' A limpeza NUNCA desprotege a aba: sao apagados apenas os campos
' destravados (os que o operador preenche). Nao pede senha.
' ---------------------------------------------------------------

' Campos preenchidos pelo operador - sao estes que a copia zera.
' (F6 = volume declarado e as celulas de calculo NAO sao limpas,
'  pois ja fazem parte do estado inicial da ficha em branco.)
Private Const CAMPOS As String = "A6,E6,J6,O6,N8,O8,B11:P24,E52,N52"

' OPCIONAL: se algum campo travado pela protecao precisar ser limpo,
' informe aqui a senha da aba. Deixando vazio, a macro apenas pula os
' campos travados, sem abrir nenhuma janela pedindo senha.
Private Const SENHA As String = ""

' Botao IMPRIMIR
Sub ImprimirFicha()
    Dim ws As Worksheet
    On Error GoTo Falha
    Set ws = FichaAtual()
    Application.ScreenUpdating = False
    ws.PrintOut Copies:=1
    Application.ScreenUpdating = True
    Exit Sub
Falha:
    Application.ScreenUpdating = True
    MsgBox "Nao foi possivel imprimir: " & Err.Description, vbExclamation, "RQ 6308"
End Sub

' Botao SALVAR COMO...
' Sugere o nome do arquivo com o produto (A6) e o lote (E6).
' Permite salvar como .xlsm (mantem os botoes) ou exportar em PDF.
Sub SalvarFichaComo()
    Dim ws As Worksheet
    Dim nome As String
    Dim destino As Variant

    On Error GoTo Falha
    Set ws = FichaAtual()

    nome = "RQ 6308 REV 03"
    If Trim(CStr(ws.Range("A6").Value)) <> "" Then
        nome = nome & " - " & Trim(CStr(ws.Range("A6").Value))
    End If
    If Trim(CStr(ws.Range("E6").Value)) <> "" Then
        nome = nome & " - Lote " & Trim(CStr(ws.Range("E6").Value))
    End If
    nome = NomeValido(nome)

    destino = Application.GetSaveAsFilename( _
        InitialFileName:=nome, _
        FileFilter:="Planilha habilitada para macro (*.xlsm),*.xlsm,PDF (*.pdf),*.pdf", _
        Title:="Salvar ficha como")

    If VarType(destino) = vbBoolean Then Exit Sub   ' usuario cancelou

    If LCase$(Right$(CStr(destino), 4)) = ".pdf" Then
        ws.ExportAsFixedFormat Type:=xlTypePDF, Filename:=CStr(destino), _
                               Quality:=xlQualityStandard, OpenAfterPublish:=False
    Else
        ThisWorkbook.SaveAs Filename:=CStr(destino), _
                            FileFormat:=xlOpenXMLWorkbookMacroEnabled
    End If
    Exit Sub
Falha:
    MsgBox "Nao foi possivel salvar: " & Err.Description, vbExclamation, "RQ 6308"
End Sub

' Botao NOVA FICHA EM BRANCO
' Duplica a ficha atual numa nova aba e apaga os campos preenchidos,
' devolvendo a ficha ao estado original em branco.
Sub NovaFichaEmBranco()
    Dim origem As Worksheet
    Dim nova As Worksheet
    Dim travados As Long

    If ThisWorkbook.ProtectStructure Then
        MsgBox "A estrutura da pasta de trabalho esta protegida, entao nao e " & _
               "possivel criar novas abas." & vbCrLf & vbCrLf & _
               "Libere em: Revisao > Proteger Pasta de Trabalho.", _
               vbExclamation, "RQ 6308"
        Exit Sub
    End If

    On Error GoTo Falha
    Set origem = FichaAtual()

    Application.ScreenUpdating = False
    origem.Copy After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count)
    Set nova = ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count)

    On Error Resume Next
    nova.Name = ProximoNome(origem.Name)
    On Error GoTo Falha

    travados = LimparCampos(nova)

    nova.Activate
    On Error Resume Next
    nova.Range("A6").Select
    On Error GoTo Falha

    Application.ScreenUpdating = True

    If travados > 0 Then
        MsgBox "Nova ficha criada, mas " & travados & " campo(s) preenchido(s) estao " & _
               "travados pela protecao da aba e continuam com conteudo." & vbCrLf & vbCrLf & _
               "Para limpa-los automaticamente, informe a senha da aba na constante " & _
               "SENHA, no topo do modulo modFicha.", vbInformation, "RQ 6308"
    End If
    Exit Sub
Falha:
    Application.ScreenUpdating = True
    MsgBox "Nao foi possivel criar a nova ficha: " & Err.Description, vbExclamation, "RQ 6308"
End Sub

' ---------------------------------------------------------------
' Rotinas auxiliares
' ---------------------------------------------------------------

' A ficha em que o botao foi clicado
Private Function FichaAtual() As Worksheet
    If TypeOf ActiveSheet Is Worksheet Then
        Set FichaAtual = ActiveSheet
    Else
        Set FichaAtual = ThisWorkbook.Worksheets(1)
    End If
End Function

' Apaga somente os campos de preenchimento destravados, preservando
' formulas, formatacao, grafico, cabecalho e a protecao da aba.
' Retorna quantos campos travados ficaram com conteudo.
Private Function LimparCampos(ws As Worksheet) As Long
    Dim partes As Variant
    Dim i As Long
    Dim area As Range
    Dim c As Range
    Dim protegida As Boolean
    Dim travados As Long

    protegida = ws.ProtectContents

    ' So desprotege se a senha tiver sido informada no topo do modulo
    If protegida And Len(SENHA) > 0 Then
        On Error Resume Next
        ws.Unprotect Password:=SENHA
        On Error GoTo 0
        protegida = ws.ProtectContents
    End If

    partes = Split(CAMPOS, ",")
    For i = LBound(partes) To UBound(partes)
        Set area = Nothing
        On Error Resume Next
        Set area = ws.Range(Trim(partes(i)))
        On Error GoTo 0

        If Not area Is Nothing Then
            For Each c In area.Cells
                If Not c.HasFormula Then
                    If protegida And c.Locked Then
                        ' campo travado: seria preciso desproteger a aba
                        If Not IsEmpty(c.Value) Then travados = travados + 1
                    Else
                        On Error Resume Next
                        c.ClearContents
                        On Error GoTo 0
                    End If
                End If
            Next c
        End If
    Next i

    ' Reprotege se tivermos desprotegido com a senha informada
    If Len(SENHA) > 0 And Not ws.ProtectContents Then
        On Error Resume Next
        ws.Protect Password:=SENHA, DrawingObjects:=True, Contents:=True, Scenarios:=True
        ws.EnableSelection = xlUnlockedCells
        On Error GoTo 0
    End If

    LimparCampos = travados
End Function

' Gera "Volume pela Densidade (2)", "(3)", ... sem repetir nome existente
Private Function ProximoNome(ByVal nomeBase As String) As String
    Dim raiz As String
    Dim i As Long
    Dim tentativa As String
    Dim pos As Long

    raiz = nomeBase
    pos = InStr(raiz, " (")
    If pos > 1 Then raiz = Left$(raiz, pos - 1)
    If Len(raiz) > 25 Then raiz = Left$(raiz, 25)

    For i = 2 To 200
        tentativa = raiz & " (" & i & ")"
        If Not AbaExiste(tentativa) Then
            ProximoNome = tentativa
            Exit Function
        End If
    Next i
    ProximoNome = raiz & " " & Format(Now, "hhmmss")
End Function

Private Function AbaExiste(ByVal nome As String) As Boolean
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        If StrComp(ws.Name, nome, vbTextCompare) = 0 Then
            AbaExiste = True
            Exit Function
        End If
    Next ws
End Function

' Remove caracteres que o Windows nao aceita em nome de arquivo
Private Function NomeValido(ByVal texto As String) As String
    Dim i As Long
    Dim proibidos As Variant
    proibidos = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For i = LBound(proibidos) To UBound(proibidos)
        texto = Replace(texto, proibidos(i), "-")
    Next i
    NomeValido = Trim(texto)
End Function
