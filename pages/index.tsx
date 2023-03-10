import React, { useState, ChangeEvent } from "react";

import Papa from "papaparse";
import axios, { AxiosError } from "axios";
import { RJSFSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import Form from "@rjsf/mui";
import dynamic from "next/dynamic";
const DynamicReactJson = dynamic(import("react-json-view"), { ssr: false });
import PQueue from "p-queue";
import Head from "next/head";
import {
  Box,
  TextField,
  FormControlLabel,
  Checkbox,
  LinearProgress,
  Container,
  Button,
  Stepper,
  Step,
  StepLabel,
  Grid,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ToggleButtonGroup,
  ToggleButton,
  Dialog,
  Snackbar,
  Typography,
  // @ts-ignore - MUI types are missing this
} from "@mui/material";
import {
  DataGrid,
  GridToolbarContainer,
  GridToolbarFilterButton,
  GridToolbarQuickFilter,
} from "@mui/x-data-grid";
import DataObjectIcon from "@mui/icons-material/DataObject";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ReplayIcon from "@mui/icons-material/Replay";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import FileUploadIcon from "@mui/icons-material/FileUpload";

const INTERNAL_INDEX_FIELD = "index";
const CHATGPT_URL = "https://api.openai.com/v1/chat/completions";
const BASE_OPENAI_RPM_LIMIT = 3500;
const MAX_RETRIES = 5;

interface IQuestion {
  question: string;
  answers: { answer: string; score: number }[];
  active: boolean;
  numResponses: number;
  weight: number;
}

const BASE_QUESTIONS: Record<string, IQuestion> = {
  grammar: {
    question:
      "Does the passage above have any grammar errors? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 0 },
      { answer: "no", score: 1 },
    ],
    active: true,
    numResponses: 10,
    weight: 1,
  },
  spelling: {
    question:
      "Does the passage above have any spelling errors? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 0 },
      { answer: "no", score: 1 },
    ],
    active: true,
    numResponses: 10,
    weight: 1,
  },
  spelling_and_grammar: {
    question:
      "Does the passage above have any spelling or grammar errors? Start your reply with a  `yes` or `no`.",
    answers: [
      { answer: "yes", score: 0 },
      { answer: "no", score: 1 },
    ],
    active: true,
    numResponses: 10,
    weight: 1,
  },
  native_speaker: {
    question:
      "Was the passage above written by a native English speaker? Start your reply with a  `yes` or `no`.",
    answers: [
      { answer: "yes", score: 1 },
      { answer: "no", score: 0 },
    ],
    active: true,
    numResponses: 10,
    weight: 1,
  },
  meets_goal: {
    question:
      "Does the passage above clearly meet the goal? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 1 },
      { answer: "no", score: 0 },
    ],
    active: true,
    numResponses: 5,
    weight: 1,
  },
  vivid_details: {
    question:
      "Does the passage use vivid details to bring the story to life? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 1 },
      { answer: "no", score: 0 },
    ],
    active: true,
    numResponses: 5,
    weight: 1,
  },
  engaging: {
    question:
      "Is the passage engaging to read? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 1 },
      { answer: "no", score: 0 },
    ],
    active: true,
    numResponses: 5,
    weight: 1,
  },
  professional: {
    question:
      "Is the passage written in a professional way? Start your reply with a `yes` or `no`.",
    answers: [
      { answer: "yes", score: 1 },
      { answer: "no", score: 0 },
    ],
    active: true,
    numResponses: 5,
    weight: 1,
  },
};

const schema: RJSFSchema = {
  title: "A customizable registration form",
  description: "A simple form with additional properties example.",
  type: "object",
  additionalProperties: {
    type: "object",
    properties: {
      question: {
        type: "string",
        title: "Question",
        default: "Does the...",
      },
      active: {
        type: "boolean",
        title: "Is Active",
        default: true,
      },
      weight: {
        type: "number",
        title: "Weight",
        default: 1,
      },
      numResponses: {
        type: "number",
        title: "# of Responses",
        default: 3,
      },
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            answer: {
              type: "string",
              title: "Answer",
              default: "Yes",
            },
            score: {
              type: "number",
              title: "Score",
              default: 1,
            },
          },
        },
      },
    },
  },
};

export default function Home() {
  // Stepper State
  const steps = ["Upload", "Assessment", "Results"];
  const [activeStep, setActiveStep] = useState<number>(0);

  // Import CSV State
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [selectedPromptColumn, setSelectedPromptColumn] = useState<
    null | string
  >("");
  const [selectedSampleColumn, setSelectedSampleColumn] = useState<
    null | string
  >("");
  const [selectedIdentifierColumn, setSelectedIdentfierColumn] = useState<
    null | string
  >("");
  const [autoIndexSamples, setAutoIndexSamples] = useState(true);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [useManualPrompt, setUseManualPrompt] = useState<boolean>(false);
  const [manualPrompt, setManualPrompt] = useState<string>("");

  // Prompt State
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are an expert copywriter who carefully evaluates passages to answer questions about them. Each passage will have a goal, a response, and a question about it."
  );
  const [userPrompt, setUserPrompt] = useState<string>(
    "Goal: $PROMPT\n\nResponse:\n```\n$SAMPLE\n```\n\n$QUESTION"
  );
  const [questions, setQuestions] =
    useState<Record<string, IQuestion>>(BASE_QUESTIONS);
  const [openAiApiKey, setOpenAiApiKey] = useState<string>("");
  const [openAiRPM, setOpenAiRPM] = useState<number>(BASE_OPENAI_RPM_LIMIT);

  // Question State
  const [questionView, setQuestionView] = useState("json");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importQuestionsText, setImportQuestionsText] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [snackbarText, setSnackbarText] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  // Evaluation State
  const [evaluationStarted, setEvaluationStarted] = useState(false);
  const [evaluationFinished, setEvaluationFinished] = useState(false);
  const [progressState, setProgressState] = useState({ evaluationProgress: 0 });
  const [outputData, setOutputData] = useState<any[]>([]);

  const loadCSV = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      // @ts-ignore - PapaParse types are wrong?
      Papa.parse(event.target.files[0], {
        header: true,
        skipEmptyLines: true,
        complete: function (results: { data: any[] }) {
          const firstItem = results.data[0];

          // Filter out rows with no values
          results.data = results.data.filter((item) => {
            return (
              Object.values(item).filter((_) => {
                // @ts-ignore TODO: It gets mad when I add (_: string) to the type too, ugh
                return _.trim() !== "";
              }).length > 0
            );
          });

          setCsvData(
            results.data.map((item, idx) => {
              item[INTERNAL_INDEX_FIELD] = idx;
              return item;
            })
          );
          setCsvColumns([...Object.keys(firstItem), INTERNAL_INDEX_FIELD]);
        },
      });
    }
  };

  function downloadCsv() {
    // Transform Output to CSV Data
    let csvOutput = outputData.map((item) => {
      for (const question of Object.keys(questions)) {
        item[question] = item.questions[question].evaluation.normalizedScore;
      }
      delete item["questions"];
      return item;
    });

    const csv = Papa.unparse(csvOutput, {
      columns: [
        ...csvColumns,
        "weightedScore",
        ...Object.keys(questions),
      ].filter((_) => {
        return _ !== INTERNAL_INDEX_FIELD;
      }),
    });

    const csvData = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    let csvURL = null;
    // @ts-ignore - IE11
    if (navigator.msSaveBlob) {
      // @ts-ignore - IE11
      csvURL = navigator.msSaveBlob(csvData, "download.csv");
    } else {
      csvURL = window.URL.createObjectURL(csvData);
    }

    // Get Current Epoch Time
    const epochTime = Math.floor(Date.now() / 1000);

    const tempLink = document.createElement("a");
    tempLink.href = csvURL;
    tempLink.setAttribute("download", `evaluation_${epochTime}.csv`);
    tempLink.click();
  }

  async function chatRequest(promptData: any) {
    // Set Headers to be JSON
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    };

    // Build Request Body
    const body = {
      model: "gpt-3.5-turbo",
      // model: "text-davinci-002",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: promptData.prompt,
        },
      ],
      n: promptData.question.numResponses,
    };

    // Exponentially Retry
    let numberOfRetries = 0;
    while (numberOfRetries <= MAX_RETRIES) {
      console.log({
        index: promptData.index,
        retries: numberOfRetries,
        promptData: promptData,
      });

      try {
        const response = await axios.post(CHATGPT_URL, body, {
          headers: headers,
        });
        promptData.response = response.data;
        promptData.success = true;
        promptData.error = null;
        if (promptData.index > progressState.evaluationProgress) {
          progressState.evaluationProgress = promptData.index;
          setProgressState({ ...progressState });
        }
        return promptData;
      } catch (rawError: any) {
        console.log(rawError);
        const error = rawError as AxiosError;
        if (error.response?.status === 429) {
          const delay = Math.pow(2, numberOfRetries + Math.random()) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          promptData.response = null;
          promptData.success = false;
          promptData.error = error;
          if (promptData.index > progressState.evaluationProgress) {
            progressState.evaluationProgress = promptData.index;
            setProgressState({ ...progressState });
          }
          return promptData;
        }
      }
      numberOfRetries++;
    }

    // Catch All
    promptData.response = null;
    promptData.success = false;
    promptData.error = "timeout";
    if (promptData.index > progressState.evaluationProgress) {
      progressState.evaluationProgress = promptData.index;
      setProgressState({ ...progressState });
    }
    return promptData;
  }

  function computeResponse(questionAsked: any, rawAnswer: any) {
    let score = 0;
    let nAnswers = 0;

    if (rawAnswer?.choices) {
      for (const choice of rawAnswer.choices) {
        // Sanitize string and break into words
        const textParts = choice.message.content
          .replace(/[^a-zA-Z0-9\s]/g, "")
          .toLowerCase()
          .split(" ");

        // Find the answer
        let VERY_HIGH_NUMBER = 100000;
        let firstAnswer = VERY_HIGH_NUMBER;
        let answerScore = 0;

        for (const answer of questionAsked.answers) {
          let idx = textParts.indexOf(
            answer.answer.replace(/[^a-zA-Z0-9\s]/g, "").toLowerCase()
          );
          if (idx !== -1 && idx < firstAnswer) {
            firstAnswer = idx;
            answerScore = answer.score;
          }
        }

        // If we found an answer, add it to the score
        if (firstAnswer !== VERY_HIGH_NUMBER) {
          score += answerScore;
          nAnswers++;
        }
      }
    }

    return {
      normalizedScore: nAnswers ? score / nAnswers : 0,
      score,
      nAnswers,
    };
  }

  function downloadQuestions() {
    const jsonQuestions = new Blob([JSON.stringify(questions, null, 2)], {
      type: "text/csv;charset=utf-8;",
    });
    let jsonURL = null;
    // @ts-ignore - IE11
    if (navigator.msSaveBlob) {
      // @ts-ignore - IE11
      jsonURL = navigator.msSaveBlob(jsonQuestions, "download.csv");
    } else {
      jsonURL = window.URL.createObjectURL(jsonQuestions);
    }

    // Get Current Epoch Time
    const epochTime = Math.floor(Date.now() / 1000);

    const tempLink = document.createElement("a");
    tempLink.href = jsonURL;
    tempLink.setAttribute("download", `questions_${epochTime}.json`);
    tempLink.click();
  }

  async function runEvaluation() {
    setEvaluationStarted(true);
    setEvaluationFinished(false);
    setProgressState({ evaluationProgress: 0 });

    // Per minute queue of requests to submit to OpenAI
    const bucketQueue = new PQueue({ interval: 60 * 1000, intervalCap: 1 });

    // Requests in a perMinute bucket to do in parallel
    const queue = new PQueue({ concurrency: 50 });
    const queueOutputs: any[] = [];

    queue.on("completed", (result) => {
      // ChatGPT request is complete, add to queueOutputs
      queueOutputs.push(result);
    });

    const prompts: any[] = [];

    // Build Prompts w/ Context
    if ((selectedPromptColumn || useManualPrompt) && selectedSampleColumn) {
      csvData.map((data, dataIdx) => {
        Object.keys(questions).map((question, qIdx) => {
          if (questions[question].active) {
            const prompt = userPrompt
              .replace(
                "$PROMPT",
                selectedPromptColumn ? data[selectedPromptColumn] : manualPrompt
              )
              .replace("$SAMPLE", data[selectedSampleColumn])
              .replace("$QUESTION", questions[question].question);

            const context = {
              prompt,
              data,
              question: questions[question],
              index: dataIdx * Object.keys(questions).length + qIdx,
              questionKey: question,
            };

            prompts.push(context);
          }
        });
      });
    }

    // Break prompts into per-minute buckets
    const perMinuteBuckets: any[] = [];
    let nRequests = 0;
    let nTokens = 0;
    let bucketIndex = 0;
    const tokenLimit = 3500000; // TODO - Use OpenAI's token limit per tier

    for (let i = 0; i < prompts.length; i++) {
      if (nRequests >= openAiRPM || nTokens >= tokenLimit) {
        bucketIndex++;
        nRequests = 0;
        nTokens = 0;
      }

      if (!perMinuteBuckets[bucketIndex]) {
        perMinuteBuckets[bucketIndex] = [];
      }

      perMinuteBuckets[bucketIndex].push(prompts[i]);
      nRequests++;
      nTokens += Math.round(prompts[i].prompt.split(" ").length / 0.66); // Conseratively approximate tokens used (OpenAI suggests .75)
    }

    const bucketsToDo = perMinuteBuckets.map((bucket) => async () => {
      const tasks = bucket.map((prompt: any) => () => chatRequest(prompt));
      await queue.addAll(tasks);
      console.log("Bucket finished!");
    });

    await bucketQueue.addAll(bucketsToDo);

    console.log("All should actually be finsiehd now!");

    const output = [];

    for (const val of queueOutputs) {
      if (!output[val.data[INTERNAL_INDEX_FIELD]]) {
        output[val.data[INTERNAL_INDEX_FIELD]] = {
          ...val.data,
          questions: {},
        };
      }

      output[val.data[INTERNAL_INDEX_FIELD]]["questions"][val.questionKey] = {
        rawAnswer: val.response,
        successfulAnswer: val.success,
        error: val.error,
        questionAsked: val.question,
        evaluation: computeResponse(val.question, val.response),
        promptUsed: val.prompt,
      };
    }

    // Compute Weighted Scores
    for (let i = 0; i < output.length; i++) {
      let score = 0;
      let nQuestionWeight = 0;
      for (const questionKey of Object.keys(output[i].questions)) {
        if (output[i].questions[questionKey].successfulAnswer) {
          score +=
            output[i].questions[questionKey].evaluation.normalizedScore *
            questions[questionKey].weight;
          nQuestionWeight += questions[questionKey].weight;
        }
      }
      output[i].weightedScore = nQuestionWeight
        ? Math.round((score / nQuestionWeight) * 100) / 100
        : 0;
    }

    setEvaluationFinished(true);
    setOutputData(output);

    console.log(output);
  }

  function CustomToolbar() {
    return (
      <GridToolbarContainer
        sx={{ display: "flex", justifyContent: "space-between" }}
      >
        <GridToolbarFilterButton />
        <GridToolbarQuickFilter />
      </GridToolbarContainer>
    );
  }

  return (
    <>
      <Head>
        <title>SampleCoach</title>
        <meta
          name="description"
          content="AI-assisted Writing Sample Analysis"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        {/* TODO: Add a Header */}

        {/* Import Modal */}
        <Dialog
          open={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          aria-labelledby="modal-modal-title"
          aria-describedby="modal-modal-description"
        >
          <Box sx={{ padding: "25px" }}>
            <h3>Import</h3>
            <Box
              sx={{
                height: 20,
                width: "100%",
                display: "block",
              }}
            ></Box>

            <TextField
              label="Question JSON to Import"
              multiline
              fullWidth
              rows={8}
              value={importQuestionsText}
              sx={{ width: "450px" }}
              onChange={(e) => setImportQuestionsText(e.target.value)}
              helperText="Paste in a valid Question JSON to import."
            />

            <Box
              sx={{
                height: 20,
                width: "100%",
                display: "block",
              }}
            ></Box>

            <Box>
              <Button
                variant="outlined"
                sx={{ marginRight: "10px" }}
                disabled={!importQuestionsText}
                onClick={() => {
                  setQuestions(JSON.parse(importQuestionsText));
                  setImportModalOpen(false);
                  setSnackbarText("Questions Imported Successfully!");
                  setSnackbarOpen(true);
                }}
              >
                <FileUploadIcon sx={{ marginRight: "10px" }} /> Import
              </Button>
            </Box>
          </Box>
        </Dialog>

        {/* Export Modal */}
        <Dialog
          open={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          aria-labelledby="modal-modal-title"
          aria-describedby="modal-modal-description"
          sx={{ marginBottom: "200px" }}
        >
          <Box sx={{ padding: "25px" }}>
            <h3>Export</h3>
            <Box
              sx={{
                height: 20,
                width: "100%",
                display: "block",
              }}
            ></Box>
            <Box>
              <Button
                variant="outlined"
                sx={{ marginRight: "10px" }}
                onClick={() => {
                  navigator.clipboard.writeText(
                    JSON.stringify(questions, null, 2)
                  );
                }}
              >
                <ContentCopyIcon sx={{ marginRight: "10px" }} /> Copy as JSON
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  downloadQuestions();
                }}
              >
                <DownloadIcon sx={{ marginRight: "10px" }} /> Download JSON
              </Button>
            </Box>
          </Box>
        </Dialog>

        {/* Snack / Toast Modal */}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={4000}
          onClose={() => setSnackbarOpen(false)}
          message={snackbarText}
        />

        <Box>
          <Container maxWidth="lg">
            <Paper sx={{ padding: 1, margin: 1 }}>
              <Grid
                container
                spacing={2}
                rowSpacing={3}
                sx={{ width: "100%", marginLeft: 0 }}
              >
                {/* Stepper Components */}
                <>
                  <Grid item xs={12}>
                    <Stepper activeStep={activeStep}>
                      {steps.map((label, index) => {
                        const stepProps: { completed?: boolean } = {};
                        if (index < activeStep) {
                          stepProps.completed = true;
                        }

                        return (
                          <Step key={label} {...stepProps}>
                            <StepLabel>{label}</StepLabel>
                          </Step>
                        );
                      })}
                    </Stepper>
                  </Grid>
                  <Grid
                    item
                    xs={12}
                    sx={{
                      justifyContent: "space-between",
                      display: "flex",
                    }}
                  >
                    <Button
                      variant="outlined"
                      disabled={activeStep === 0}
                      onClick={() => setActiveStep(activeStep - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={activeStep === steps.length - 1}
                      onClick={() => setActiveStep(activeStep + 1)}
                    >
                      Next
                    </Button>
                  </Grid>
                </>

                {/* CSV Import + Preview */}
                {activeStep === 0 && (
                  <>
                    <Grid item xs={12} lg={3}>
                      <Box padding={"5px"}>
                        <b>File Selector</b>
                      </Box>
                      <input
                        type="file"
                        name="file"
                        accept=".csv"
                        onChange={loadCSV}
                        style={{ display: "block", margin: "10px auto" }}
                      />
                    </Grid>

                    <Grid item xs={12} lg={3}>
                      <Box padding={"5px"}>
                        <b>Prompt</b> Column
                      </Box>
                      <FormControl fullWidth>
                        <InputLabel id="prompt-select-label">Prompt</InputLabel>
                        <Select
                          value={selectedPromptColumn}
                          labelId="prompt-select-label"
                          label="Question"
                          disabled={useManualPrompt}
                          onChange={(e) =>
                            setSelectedPromptColumn(e.target.value)
                          }
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {csvColumns
                            .filter((_) => {
                              return _ !== INTERNAL_INDEX_FIELD;
                            })
                            .map((column, idx) => (
                              <MenuItem key={idx} value={column}>
                                {column}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={useManualPrompt}
                            onChange={(e) => {
                              setUseManualPrompt(e.target.checked);
                              setSelectedPromptColumn("");
                            }}
                            inputProps={{ "aria-label": "Auto-generate Ids" }}
                          />
                        }
                        label="Just write the Prompt instead"
                      />
                      {useManualPrompt && (
                        <TextField
                          label="Write in the prompt/goal"
                          multiline
                          fullWidth
                          rows={3}
                          value={manualPrompt}
                          onChange={(e) => setManualPrompt(e.target.value)}
                          helperText="This prompt will be used to assess each sample."
                        />
                      )}
                    </Grid>

                    <Grid item xs={12} lg={3}>
                      <Box padding={"5px"}>
                        <b>Sample</b> Column
                      </Box>
                      <FormControl fullWidth>
                        <InputLabel id="sample-select-label">Sample</InputLabel>
                        <Select
                          value={selectedSampleColumn}
                          labelId="sample-select-label"
                          label="Sample"
                          onChange={(e) =>
                            setSelectedSampleColumn(e.target.value)
                          }
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {csvColumns
                            .filter((_) => {
                              return _ !== INTERNAL_INDEX_FIELD;
                            })
                            .map((column, idx) => (
                              <MenuItem key={idx} value={column}>
                                {column}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid item xs={12} lg={3}>
                      <Box padding={"5px"}>
                        <b>Identifier</b> Column{" "}
                        <span style={{ fontSize: "12px", color: "#666" }}>
                          (Optional)
                        </span>
                      </Box>
                      <FormControl fullWidth>
                        <InputLabel id="identifier-select-label">
                          Identifier
                        </InputLabel>
                        <Select
                          value={selectedIdentifierColumn}
                          labelId="identifier-select-label"
                          label="Identifier"
                          onChange={(e) => {
                            setSelectedIdentfierColumn(e.target.value);
                            setAutoIndexSamples(false);
                            if (!e.target.value) {
                              setAutoIndexSamples(true);
                            }
                          }}
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {csvColumns
                            .filter((_) => {
                              return _ !== INTERNAL_INDEX_FIELD;
                            })
                            .map((column, idx) => (
                              <MenuItem key={idx} value={column}>
                                {column}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={autoIndexSamples}
                            onChange={(e) => {
                              setAutoIndexSamples(e.target.checked);
                              setSelectedIdentfierColumn("");
                            }}
                            inputProps={{ "aria-label": "Auto-generate Ids" }}
                          />
                        }
                        label="Auto-generate Ids"
                      />
                    </Grid>

                    <Box
                      sx={{
                        height: 20,
                        width: "100%",
                        display: "block",
                      }}
                    ></Box>

                    {csvData.length > 0 &&
                      (selectedIdentifierColumn || autoIndexSamples) &&
                      (selectedPromptColumn ||
                        (manualPrompt && useManualPrompt)) &&
                      selectedSampleColumn && (
                        <Box
                          sx={{
                            display: "flex",
                            width: "100%",
                            margin: "0 auto",
                          }}
                        >
                          <Box sx={{ flexGrow: 1, height: 400 }}>
                            <DataGrid
                              rows={csvData.map((row, idx) => {
                                if (useManualPrompt) {
                                  return {
                                    ...row,
                                    prompt: manualPrompt,
                                    id: idx,
                                  };
                                } else {
                                  return { ...row, id: idx };
                                }
                              })}
                              columns={[
                                {
                                  field: autoIndexSamples
                                    ? INTERNAL_INDEX_FIELD
                                    : selectedIdentifierColumn || "",
                                  headerName: "Identifier",
                                  width: 150,
                                },
                                {
                                  field: selectedPromptColumn || "prompt",
                                  headerName: "Prompt",
                                  flex: 0.3,
                                },
                                {
                                  field: selectedSampleColumn,
                                  headerName: "Sample",
                                  flex: 0.7,
                                },
                              ]}
                              components={{ Toolbar: CustomToolbar }}
                              componentsProps={{
                                toolbar: {
                                  showQuickFilter: true,
                                  quickFilterProps: { debounceMs: 500 },
                                },
                              }}
                              disableSelectionOnClick
                            />
                          </Box>
                        </Box>
                      )}
                  </>
                )}

                {/* Questions and Prompt Settings */}
                {activeStep === 1 && (
                  <>
                    {/* Question Section */}
                    <Grid item xs={12} lg={6}>
                      <Paper
                        sx={{
                          padding: "10px",
                          display: "flex",
                          flexFlow: "wrap",
                          rowGap: "20px",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            width: "100%",
                            justifyContent: "space-between",
                          }}
                        >
                          {/* Title */}
                          <Box>
                            <h3>Questions</h3>
                          </Box>
                          <Box>
                            <Button
                              variant="outlined"
                              sx={{ marginRight: "10px" }}
                              onClick={() => setImportModalOpen(true)}
                            >
                              Import
                            </Button>
                            <Button
                              variant="outlined"
                              onClick={() => setExportModalOpen(true)}
                            >
                              Export
                            </Button>
                          </Box>

                          {/* Question Format */}
                          <ToggleButtonGroup
                            value={questionView}
                            exclusive
                            onChange={(e, v) => setQuestionView(v)}
                            size="small"
                            color="primary"
                          >
                            <ToggleButton value="wizard">
                              <AutoFixHighIcon
                              // sx={{ paddingRight: "5px" }}
                              />
                              {/* Wizard */}
                            </ToggleButton>
                            <ToggleButton value="json">
                              <DataObjectIcon
                              // sx={{ paddingRight: "5px" }}
                              />{" "}
                              {/* JSON */}
                            </ToggleButton>
                          </ToggleButtonGroup>
                        </Box>

                        {/* Wizard View */}
                        {questionView === "wizard" && (
                          <Form
                            schema={schema}
                            validator={validator}
                            formData={questions}
                            onChange={(e) => {
                              setQuestions(e.formData);
                            }}
                          />
                        )}

                        {/* JSON View  */}
                        {questionView === "json" && (
                          <Box>
                            <DynamicReactJson
                              src={questions}
                              displayDataTypes={false}
                              displayObjectSize={false}
                              // @ts-ignore - this is a valid prop
                              displayArrayKey={false}
                              collapsed={1}
                              onEdit={(e) => {
                                setQuestions(
                                  e.updated_src as Record<string, IQuestion>
                                );
                              }}
                              onAdd={(e) => {
                                setQuestions(
                                  e.updated_src as Record<string, IQuestion>
                                );
                              }}
                              onDelete={(e) => {
                                setQuestions(
                                  e.updated_src as Record<string, IQuestion>
                                );
                              }}
                            />
                            <Box sx={{ height: "20px", width: "100%" }}></Box>
                            <Button
                              variant="outlined"
                              onClick={() => {
                                setQuestions(BASE_QUESTIONS);
                              }}
                            >
                              <ReplayIcon sx={{ marginRight: "10px" }} /> Reset
                            </Button>
                          </Box>
                        )}
                      </Paper>
                    </Grid>

                    {/* Prompt and OpenAI Settings */}
                    <Grid item xs={12} lg={6}>
                      <Paper
                        sx={{
                          padding: "10px",
                          display: "flex",
                          flexFlow: "wrap",
                          rowGap: "20px",
                        }}
                      >
                        <h3>Prompt Settings</h3>
                        <TextField
                          label="OpenAI API Key"
                          fullWidth
                          type="password"
                          value={openAiApiKey}
                          onChange={(e) => setOpenAiApiKey(e.target.value)}
                          helperText="Your API key can be found in the OpenAI dashboard. It only exists in the browser and is not stored on the server."
                        />

                        <Typography
                          variant="button"
                          sx={{ marginBottom: "-15px" }}
                        >
                          Requests per Minute
                        </Typography>
                        <ToggleButtonGroup
                          color="primary"
                          value={openAiRPM}
                          exclusive
                          onChange={(e, v) => setOpenAiRPM(v)}
                          sx={{ width: "100%" }}
                        >
                          <ToggleButton value={20}>
                            20
                            <br></br>(Free Tier)
                          </ToggleButton>
                          <ToggleButton value={60}>
                            60<br></br>(Paid, first 48 hours)
                          </ToggleButton>
                          <ToggleButton value={3500}>
                            3,500<br></br>(Paid)
                          </ToggleButton>
                        </ToggleButtonGroup>
                        <Typography
                          variant="body2"
                          gutterBottom
                          sx={{
                            marginTop: "-15px",
                            padding: "0px 10px",
                            color: "rgba(0, 0, 0, 0.6);",
                            fontSize: ".75rem",
                          }}
                        >
                          The free tier has a limit of 20 requests per minute.
                          Pay-as-you-go has a limit of 3,500 requests per minute
                          (after 48 hours, 60 before). This application will
                          handle the rate limiting for you, but setting this
                          allows us to be nicer to OpenAI.
                        </Typography>

                        <TextField
                          label="System Initialization"
                          multiline
                          fullWidth
                          rows={4}
                          value={systemPrompt}
                          onChange={(e) => setSystemPrompt(e.target.value)}
                          helperText="This prompt will be used to instruct the bot on who it is and what role it has."
                        />
                        <TextField
                          label="Prompt Template"
                          multiline
                          fullWidth
                          rows={8}
                          value={userPrompt}
                          onChange={(e) => setUserPrompt(e.target.value)}
                          helperText="The prompt, sample, and question will be inserted into this template using the $PROMPT, $SAMPLE, and $QUESTION variables."
                        />
                      </Paper>
                    </Grid>
                  </>
                )}

                {/* Evaluation */}
                {activeStep === 2 && (
                  <>
                    <Grid item xs={12} lg={4}>
                      <Paper
                        sx={{
                          padding: "10px",
                          display: "flex",
                          flexFlow: "wrap",
                          rowGap: "20px",
                        }}
                      >
                        <h3>Preview</h3>
                        <Box width={"100%"}>
                          <b># of Samples:</b>
                          {" " + csvData.length}
                        </Box>
                        {/* TODO: Filter to only active questions */}
                        <Box width={"100%"}>
                          <b># of Questions:</b>
                          {" " + Object.keys(questions).length}
                        </Box>
                        <Box width={"100%"}>
                          <b>Total Combinations:</b>
                          {" " + Object.keys(questions).length * csvData.length}
                        </Box>

                        <Box sx={{ textAlign: "center" }}>
                          <Button
                            variant="contained"
                            onClick={() => runEvaluation()}
                            sx={{ margin: "0 auto" }}
                          >
                            Start Evaluation
                          </Button>
                        </Box>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} lg={8} sx={{}}>
                      <Paper sx={{ padding: "10px" }}>
                        <h3>Output</h3>
                        {!evaluationStarted && (
                          <>
                            <Box sx={{ height: "20px", width: "100%" }}></Box>
                            <p>
                              Click <b>Start Evaluation</b> to start the
                              analysis
                            </p>
                            <br></br>
                            <p>
                              <b>Estimated Completion Time:</b>{" "}
                              {Math.floor(
                                (Object.keys(questions).length *
                                  csvData.length) /
                                  openAiRPM
                              )}{" "}
                              to{" "}
                              {Math.ceil(
                                (Object.keys(questions).length *
                                  csvData.length) /
                                  openAiRPM
                              )}{" "}
                              minutes
                            </p>
                          </>
                        )}
                        {evaluationStarted && (
                          <>
                            <Box sx={{ height: "20px", width: "100%" }}></Box>
                            <h4>Progress</h4>
                            <LinearProgress
                              variant="determinate"
                              value={
                                evaluationFinished
                                  ? 100
                                  : ((progressState.evaluationProgress /
                                      (Object.keys(questions).length *
                                        csvData.length)) *
                                      100) % // TODO: Figure out why progress state isn't sticking at zero
                                    100
                              }
                            />
                          </>
                        )}
                        {evaluationFinished && (
                          <>
                            <Box sx={{ height: "20px", width: "100%" }}></Box>
                            <Button
                              variant="outlined"
                              onClick={() => downloadCsv()}
                            >
                              Download .csv
                            </Button>
                          </>
                        )}
                      </Paper>
                    </Grid>
                  </>
                )}
              </Grid>
            </Paper>
          </Container>
        </Box>
      </main>
    </>
  );
}
