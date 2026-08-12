export type MainSurveySectionDefinition = {
  section: string;
  title: string;
  slug: string;
  pageEnabled: boolean;
  dictionaryLoaded: boolean;
};

export type MainSurveyDictionaryRow = {
  variable: string;
  label: string;
  storageType: string;
  measure: string;
  valueLabels: string;
};

const SECTION_CATALOG_RAW = `
RESPONDENT PROFILE|Respondent Profile|respondent-profile|true|true
REMITTANCE SOURCES|Remittance Sources|remittance-sources|true|true
TRANSFER CHANNELS|Transfer Channels|transfer-channels|true|true
VALUE AND FREQUENCY|Value And Frequency|value-and-frequency|true|true
USE OF REMITTANCE|Use Of Remittance|use-of-remittance|true|true
TRUST FEES AND EXPERIENCE|Trust Fees And Experience|trust-fees-and-experience|true|true
`;

const FINANCIAL_CAPABILITY_RAW = `
F3	F3. Thinking about money matters and goals that require a large amount of money, what if anything, would you say is the main goal that you are currently trying to achieve?	numeric	scale	1.0=Buying land | 2.0=Buying or building a house/apartment to live in | 3.0=Buying or building a house/apartment to rent out or sell | 4.0=Moving into my own or a better house/apartment | 5.0=Paying for a big life event such as a wedding, birth of a child, milestone birthday | 6.0=Paying for a family member's education or my education | 7.0=Paying for a holiday, travel or visiting someone | 8.0=Buying or paying for a vehicle | 9.0=Buying or paying for a purchase such as furniture, TV, phone etc. | 10.0=Starting a business | 11.0=Buying equipment or assets for a business or agricultural activity | 12.0=Expanding my business | 13.0=Relocating abroad - JAPA | 14.0=Repair for house/work after a weather related event | 95.0=Refused to answer | 96.0=I do not have any of these goals now | 98.0=Other Specify | 99.0=Do not know
F3.OTH	Other Specify	string	nominal	
F3.cal	Goal label helper	string	nominal	
F4a	F4a. And what have you done, if anything, in the last year to achieve this goal?	string	nominal	
F4a_1	F4a. Borrowed from a bank or other formal institution?	numeric	scale	0.0=No | 1.0=Yes
F4a_2	F4a. Borrowed from a digital microfinance provider?	numeric	scale	0.0=No | 1.0=Yes
F4a_3	F4a. Borrowed from a moneylender (informal)?	numeric	scale	0.0=No | 1.0=Yes
F4a_4	F4a. Borrowed from saving group/cooperative?	numeric	scale	0.0=No | 1.0=Yes
F4a_5	F4a. Borrowed from family, friends, community, church or mosque?	numeric	scale	0.0=No | 1.0=Yes
F4a_6	F4a. Took a loan or advance from employer?	numeric	scale	0.0=No | 1.0=Yes
F4a_7	F4a. Took a loan from a shopkeeper?	numeric	scale	0.0=No | 1.0=Yes
F4a_8	F4a. Used savings held at a formal institution?	numeric	scale	0.0=No | 1.0=Yes
F4a_9	F4a. Used investments?	numeric	scale	0.0=No | 1.0=Yes
F4a_10	F4a. Used savings from savings group or thrift collector?	numeric	scale	0.0=No | 1.0=Yes
F4a_11	F4a. Used savings held with friends or family?	numeric	scale	0.0=No | 1.0=Yes
F4a_12	F4a. Used savings held in a secret hiding place?	numeric	scale	0.0=No | 1.0=Yes
F4a_22	F4a. Used pension savings?	numeric	scale	0.0=No | 1.0=Yes
F4a_13	F4a. Sold livestock?	numeric	scale	0.0=No | 1.0=Yes
F4a_14	F4a. Sold other assets such as car, business, household goods, or land?	numeric	scale	0.0=No | 1.0=Yes
F4a_15	F4a. Got money or assistance from family, friends, or community without repayment?	numeric	scale	0.0=No | 1.0=Yes
F4a_16	F4a. Cut back on expenses?	numeric	scale	0.0=No | 1.0=Yes
F4a_17	F4a. Worked more or got additional jobs?	numeric	scale	0.0=No | 1.0=Yes
F4a_18	F4a. Bought on credit?	numeric	scale	0.0=No | 1.0=Yes
F4a_19	F4a. Bought on hire purchase?	numeric	scale	0.0=No | 1.0=Yes
F4a_20	F4a. Got a credit card or extended credit card limit?	numeric	scale	0.0=No | 1.0=Yes
F4a_21	F4a. Had a goal but did nothing in the past 12 months to achieve it?	numeric	scale	0.0=No | 1.0=Yes
F4a_98	F4a. Other action, specify?	numeric	scale	0.0=No | 1.0=Yes
F4b	F4b. Which of these would you say is your main means of achieving your goal?	numeric	scale	1.0=Borrowed from a bank or other formal institution | 2.0=Borrowed from a digital microfinance provider | 3.0=Borrowed from moneylender (informal) | 4.0=Borrowed from saving group/cooperative | 5.0=Borrowed from family, friends, community, church or mosque | 6.0=Took a loan or advance from employer | 7.0=Took a loan from a shopkeeper | 8.0=Used savings held at a formal institution | 9.0=Used investments | 10.0=Used savings from savings group or thrift collector | 11.0=Used savings held with friends or family | 12.0=Used savings held in a secret hiding place | 13.0=Sold livestock | 14.0=Sold other assets such as car, business, household goods, or land | 15.0=Got money or assistance without repayment | 16.0=Cut back on expenses | 17.0=Worked more or got additional jobs | 18.0=Bought on credit | 19.0=Bought on hire purchase | 20.0=Got a credit card or extended credit card limit | 21.0=Did nothing in the past 12 months | 22.0=Used pension savings | 98.0=Other, specify
F5a	F5a. Do you save or keep money for different reasons and how often?	numeric	scale	1.0=Always | 2.0=Sometimes | 3.0=Do not save
F5b	F5b. Do you invest money in assets and how often?	numeric	scale	1.0=Always | 2.0=Sometimes | 3.0=Do not invest
F5c	F5c. If your household had no income, for how many months could you cover living expenses using savings, investments, or items you own?	numeric	scale	1.0=Less than one month | 2.0=One month | 3.0=2-3 months | 4.0=4-6 months | 5.0=More than 6 months | 96.0=Do not know
F6	F6. To what extent do you agree or disagree with the statement: I actively plan how to use my money for future expenses and goals.	numeric	scale	1.0=Strongly Disagree | 2.0=Disagree | 3.0=Neutral | 4.0=Agree | 5.0=Strongly Agree
F7a1	F7a1. In the past 12 months, how often have you experienced running out of money and could not cover your expenses?	numeric	scale	1.0=Monthly | 2.0=For more than one month in the last twelve months | 3.0=One month in the past year | 4.0=It has not happened in the last twelve months
F7b	F7b. What did you mainly do to pay for things when this happened?	numeric	scale	1.0=Used savings from a bank or other formal financial institution | 2.0=Used savings from an informal institution such as savings group or village association | 3.0=Sold asset(s) | 4.0=Got an advance on salary | 5.0=Borrowed money from a bank or other formal financial institution | 6.0=Borrowed money from a group they belong to | 7.0=Borrowed from a moneylender in the community | 8.0=Borrowed from savings or thrift collector or merchant | 9.0=Borrowed from family or friends | 10.0=Cut down on other expenses | 11.0=Bought goods on credit | 12.0=Received gifts, donations, or contributions from friends or family | 13.0=Did nothing specific | 14.0=Borrowed money from a microfinance bank | 98.0=Other, specify
F7b.OTH	Other Specify	string	nominal	
F7b1	F7b1. Over the past 12 months, how would you describe your income and spending?	numeric	scale	1.0=Generally spend much less than income | 2.0=Generally spend a little less than income | 3.0=Generally spend about the same as income | 4.0=Generally spend a little more than income | 5.0=Generally spend much more than income | 95.0=Refused | 96.0=Do not know
F7c	F7c. How difficult would it be for you to come up with Naira 156,000 within the next 7 days?	numeric	scale	1.0=Very difficult | 2.0=Somewhat difficult | 3.0=Not difficult at all | 95.0=Refused | 96.0=Do not know
F7d	F7d. How would you mainly raise this money?	numeric	scale	1.0=Savings from a bank or other financial institution | 2.0=An informal institution such as savings group or village association | 3.0=Sell asset(s) | 4.0=Get an advance on salary | 5.0=Borrow money from a bank or other financial institution | 6.0=Borrowed money from a group they belong to | 7.0=Borrow from a moneylender in the community | 8.0=Borrow from savings or thrift collector or merchant | 9.0=Borrow from family or friends | 10.0=Gifts, donations, or contributions from friends or family | 11.0=Borrow money from a microfinance bank | 98.0=Other, specify
F7d.OTH	Other Specify	string	nominal	
F9	F9. Imagine that five friends are given a gift of 20,000 Naira. If the friends must share the money equally, how much does each one get?	numeric	scale	1.0=Correct | 2.0=Incorrect | 3.0=Irrelevant answer | 95.0=Refused to answer | 96.0=Do not know | 99.0=Not sure
F10	F10. If you could choose between two options, which would you take?	numeric	scale	1.0=A sure gain of Naira 10,000 | 2.0=A 50% chance to gain Naira 20,000 and a 50% chance to gain nothing | 95.0=Refused to answer
F11	F11. If you could choose between two options, which would you take?	numeric	scale	1.0=A sure loss of Naira 10,000 | 2.0=A 50% chance to lose Naira 20,000 and a 50% chance to lose nothing | 95.0=Refused to answer
F12.1	When you get or acquire financial products or services like loans, bank accounts, or payment services you compare different options and choose the best one for your needs	numeric	scale	1.0=Yes | 2.0=Sometimes | 3.0=No | 98.0=Not applicable
F12.2	You know what to do when not satisfied with a financial service or product	numeric	scale	1.0=Yes | 2.0=Sometimes | 3.0=No | 98.0=Not applicable
F12.3	You are confident enough to make a complaint against a bank or financial institution if you are not satisfied	numeric	scale	1.0=Yes | 2.0=Sometimes | 3.0=No | 98.0=Not applicable
F12.4	You understand the terms and conditions in the contract with a financial institution	numeric	scale	1.0=Yes | 2.0=Sometimes | 3.0=No | 98.0=Not applicable
F12b.1	Make a deposit or cash-in	numeric	scale	1.0=Not at all confident | 2.0=2 | 3.0=3 | 4.0=4 | 5.0=Very confident
F12b.2	Make a withdrawal or cash-out	numeric	scale	1.0=Not at all confident | 2.0=2 | 3.0=3 | 4.0=4 | 5.0=Very confident
F12b.3	Send money to someone	numeric	scale	1.0=Not at all confident | 2.0=2 | 3.0=3 | 4.0=4 | 5.0=Very confident
F12b.4	Apply for a loan	numeric	scale	1.0=Not at all confident | 2.0=2 | 3.0=3 | 4.0=4 | 5.0=Very confident
F14.label	Financial Product Association	string	nominal	
F14	F14. Do you feel that your financial provider always explains their products and fees in a clear way you can easily understand?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F15	F15. Have you been surprised by hidden fees or extra charges from a financial service provider in the past 12 months?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F16	F16. In the past 12 months, have you been informed of changes to fees or charges of financial products and services?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F17	F17. Do you feel that fees or charges by formal financial institutions are affordable?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F18	F18. Have you been unfairly treated by staff or agent from a financial institution?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F19	F19. Do you think your financial service providers are doing all within their power to protect your personal information from fraudulent persons?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F20	F20. In the last 30 days, was there any time you could not complete a transaction because your bank's platform was down?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F26	F26. You are satisfied with your financial institution's customer support	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F27	F27. Whenever you visit a bank branch, you are always served on time.	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F28	F28. You use a mobile phone and or tablet to manage financial activities.	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F29	F29. Do you budget for your money?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F30	F30. Do you know how much money you spent personally in the last 7 days?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F31	F31. Do you keep track of the money you get and spend?	numeric	scale	1.0=Yes | 2.0=No | 97.0=Do not know | 98.0=Not applicable
F12c	F12c. How many transactions did you make through formal financial services in the last 30 days?	numeric	scale	1.0=1-2 times | 2.0=3-5 times | 3.0=6-10 times | 4.0=Above 10 times | 99.0=None
`;

function parseSections(raw: string): MainSurveySectionDefinition[] {
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      const [section, title, slug, pageEnabled, dictionaryLoaded] = line.split("|");
      return {
        section,
        title,
        slug,
        pageEnabled: pageEnabled === "true",
        dictionaryLoaded: dictionaryLoaded === "true",
      };
    });
}

function parseDictionary(raw: string): MainSurveyDictionaryRow[] {
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      const [variable, label, storageType, measure, valueLabels = ""] = line.split("\t");
      return { variable, label, storageType, measure, valueLabels };
    });
}

export const MAIN_SURVEY_SECTIONS = parseSections(SECTION_CATALOG_RAW);

export const MAIN_SURVEY_PAGE_SECTIONS = MAIN_SURVEY_SECTIONS.filter((section) => section.pageEnabled);

const NAV_EXCLUDED_SLUGS = new Set<string>();

export const MAIN_SURVEY_SECTION_NAV_ITEMS = [
  ...MAIN_SURVEY_PAGE_SECTIONS
    .filter((section) => !NAV_EXCLUDED_SLUGS.has(section.slug))
    .map((section) => ({
      title: section.title,
      url: `/main/${section.slug}`,
    })),
];

export function findMainSurveySectionBySlug(slug: string) {
  return MAIN_SURVEY_PAGE_SECTIONS.find((section) => section.slug === slug);
}

export const FINANCIAL_CAPABILITY_DICTIONARY = parseDictionary(FINANCIAL_CAPABILITY_RAW);
