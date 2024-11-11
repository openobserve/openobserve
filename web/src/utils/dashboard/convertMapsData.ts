// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const countries = [
  { name: "Afghanistan", alpha2: "AF", alpha3: "AFG" },
  { name: "Albania", alpha2: "AL", alpha3: "ALB" },
  { name: "Algeria", alpha2: "DZ", alpha3: "DZA" },
  { name: "Andorra", alpha2: "AD", alpha3: "AND" },
  { name: "Angola", alpha2: "AO", alpha3: "AGO" },
  { name: "Antigua and Barbuda", alpha2: "AG", alpha3: "ATG" },
  { name: "Argentina", alpha2: "AR", alpha3: "ARG" },
  { name: "Armenia", alpha2: "AM", alpha3: "ARM" },
  { name: "Australia", alpha2: "AU", alpha3: "AUS" },
  { name: "Austria", alpha2: "AT", alpha3: "AUT" },
  { name: "Azerbaijan", alpha2: "AZ", alpha3: "AZE" },
  { name: "Bahamas", alpha2: "BS", alpha3: "BHS" },
  { name: "Bahrain", alpha2: "BH", alpha3: "BHR" },
  { name: "Bangladesh", alpha2: "BD", alpha3: "BGD" },
  { name: "Barbados", alpha2: "BB", alpha3: "BRB" },
  { name: "Belarus", alpha2: "BY", alpha3: "BLR" },
  { name: "Belgium", alpha2: "BE", alpha3: "BEL" },
  { name: "Belize", alpha2: "BZ", alpha3: "BLZ" },
  { name: "Benin", alpha2: "BJ", alpha3: "BEN" },
  { name: "Bhutan", alpha2: "BT", alpha3: "BTN" },
  { name: "Bolivia", alpha2: "BO", alpha3: "BOL" },
  { name: "Bosnia and Herzegovina", alpha2: "BA", alpha3: "BIH" },
  { name: "Botswana", alpha2: "BW", alpha3: "BWA" },
  { name: "Brazil", alpha2: "BR", alpha3: "BRA" },
  { name: "Brunei", alpha2: "BN", alpha3: "BRN" },
  { name: "Bulgaria", alpha2: "BG", alpha3: "BGR" },
  { name: "Burkina Faso", alpha2: "BF", alpha3: "BFA" },
  { name: "Burundi", alpha2: "BI", alpha3: "BDI" },
  { name: "Cabo Verde", alpha2: "CV", alpha3: "CPV" },
  { name: "Cambodia", alpha2: "KH", alpha3: "KHM" },
  { name: "Cameroon", alpha2: "CM", alpha3: "CMR" },
  { name: "Canada", alpha2: "CA", alpha3: "CAN" },
  { name: "Central African Republic", alpha2: "CF", alpha3: "CAF" },
  { name: "Chad", alpha2: "TD", alpha3: "TCD" },
  { name: "Chile", alpha2: "CL", alpha3: "CHL" },
  { name: "China", alpha2: "CN", alpha3: "CHN" },
  { name: "Colombia", alpha2: "CO", alpha3: "COL" },
  { name: "Comoros", alpha2: "KM", alpha3: "COM" },
  { name: "Congo (Congo-Brazzaville)", alpha2: "CG", alpha3: "COG" },
  { name: "Congo (DRC)", alpha2: "CD", alpha3: "COD" },
  { name: "Costa Rica", alpha2: "CR", alpha3: "CRI" },
  { name: "Croatia", alpha2: "HR", alpha3: "HRV" },
  { name: "Cuba", alpha2: "CU", alpha3: "CUB" },
  { name: "Cyprus", alpha2: "CY", alpha3: "CYP" },
  { name: "Czechia", alpha2: "CZ", alpha3: "CZE" },
  { name: "Denmark", alpha2: "DK", alpha3: "DNK" },
  { name: "Djibouti", alpha2: "DJ", alpha3: "DJI" },
  { name: "Dominica", alpha2: "DM", alpha3: "DMA" },
  { name: "Dominican Republic", alpha2: "DO", alpha3: "DOM" },
  { name: "Ecuador", alpha2: "EC", alpha3: "ECU" },
  { name: "Egypt", alpha2: "EG", alpha3: "EGY" },
  { name: "El Salvador", alpha2: "SV", alpha3: "SLV" },
  { name: "Equatorial Guinea", alpha2: "GQ", alpha3: "GNQ" },
  { name: "Eritrea", alpha2: "ER", alpha3: "ERI" },
  { name: "Estonia", alpha2: "EE", alpha3: "EST" },
  { name: "Eswatini", alpha2: "SZ", alpha3: "SWZ" },
  { name: "Ethiopia", alpha2: "ET", alpha3: "ETH" },
  { name: "Fiji", alpha2: "FJ", alpha3: "FJI" },
  { name: "Finland", alpha2: "FI", alpha3: "FIN" },
  { name: "France", alpha2: "FR", alpha3: "FRA" },
  { name: "Gabon", alpha2: "GA", alpha3: "GAB" },
  { name: "Gambia", alpha2: "GM", alpha3: "GMB" },
  { name: "Georgia", alpha2: "GE", alpha3: "GEO" },
  { name: "Germany", alpha2: "DE", alpha3: "DEU" },
  { name: "Ghana", alpha2: "GH", alpha3: "GHA" },
  { name: "Greece", alpha2: "GR", alpha3: "GRC" },
  { name: "Grenada", alpha2: "GD", alpha3: "GRD" },
  { name: "Guatemala", alpha2: "GT", alpha3: "GTM" },
  { name: "Guinea", alpha2: "GN", alpha3: "GIN" },
  { name: "Guinea-Bissau", alpha2: "GW", alpha3: "GNB" },
  { name: "Guyana", alpha2: "GY", alpha3: "GUY" },
  { name: "Haiti", alpha2: "HT", alpha3: "HTI" },
  { name: "Honduras", alpha2: "HN", alpha3: "HND" },
  { name: "Hong Kong", alpha2: "HK", alpha3: "HKG" },
  { name: "Hungary", alpha2: "HU", alpha3: "HUN" },
  { name: "Iceland", alpha2: "IS", alpha3: "ISL" },
  { name: "India", alpha2: "IN", alpha3: "IND" },
  { name: "Indonesia", alpha2: "ID", alpha3: "IDN" },
  { name: "Iran", alpha2: "IR", alpha3: "IRN" },
  { name: "Iraq", alpha2: "IQ", alpha3: "IRQ" },
  { name: "Ireland", alpha2: "IE", alpha3: "IRL" },
  { name: "Israel", alpha2: "IL", alpha3: "ISR" },
  { name: "Italy", alpha2: "IT", alpha3: "ITA" },
  { name: "Jamaica", alpha2: "JM", alpha3: "JAM" },
  { name: "Japan", alpha2: "JP", alpha3: "JPN" },
  { name: "Jordan", alpha2: "JO", alpha3: "JOR" },
  { name: "Kazakhstan", alpha2: "KZ", alpha3: "KAZ" },
  { name: "Kenya", alpha2: "KE", alpha3: "KEN" },
  { name: "Kiribati", alpha2: "KI", alpha3: "KIR" },
  { name: "Korea (North)", alpha2: "KP", alpha3: "PRK" },
  { name: "Korea (South)", alpha2: "KR", alpha3: "KOR" },
  { name: "Kuwait", alpha2: "KW", alpha3: "KWT" },
  { name: "Kyrgyzstan", alpha2: "KG", alpha3: "KGZ" },
  { name: "Laos", alpha2: "LA", alpha3: "LAO" },
  { name: "Latvia", alpha2: "LV", alpha3: "LVA" },
  { name: "Lebanon", alpha2: "LB", alpha3: "LBN" },
  { name: "Lesotho", alpha2: "LS", alpha3: "LSO" },
  { name: "Liberia", alpha2: "LR", alpha3: "LBR" },
  { name: "Libya", alpha2: "LY", alpha3: "LBY" },
  { name: "Liechtenstein", alpha2: "LI", alpha3: "LIE" },
  { name: "Lithuania", alpha2: "LT", alpha3: "LTU" },
  { name: "Luxembourg", alpha2: "LU", alpha3: "LUX" },
  { name: "Madagascar", alpha2: "MG", alpha3: "MDG" },
  { name: "Malawi", alpha2: "MW", alpha3: "MWI" },
  { name: "Malaysia", alpha2: "MY", alpha3: "MYS" },
  { name: "Maldives", alpha2: "MV", alpha3: "MDV" },
  { name: "Mali", alpha2: "ML", alpha3: "MLI" },
  { name: "Malta", alpha2: "MT", alpha3: "MLT" },
  { name: "Marshall Islands", alpha2: "MH", alpha3: "MHL" },
  { name: "Mauritania", alpha2: "MR", alpha3: "MRT" },
  { name: "Mauritius", alpha2: "MU", alpha3: "MUS" },
  { name: "Mexico", alpha2: "MX", alpha3: "MEX" },
  { name: "Micronesia", alpha2: "FM", alpha3: "FSM" },
  { name: "Moldova", alpha2: "MD", alpha3: "MDA" },
  { name: "Monaco", alpha2: "MC", alpha3: "MCO" },
  { name: "Mongolia", alpha2: "MN", alpha3: "MNG" },
  { name: "Montenegro", alpha2: "ME", alpha3: "MNE" },
  { name: "Morocco", alpha2: "MA", alpha3: "MAR" },
  { name: "Mozambique", alpha2: "MZ", alpha3: "MOZ" },
  { name: "Myanmar (Burma)", alpha2: "MM", alpha3: "MMR" },
  { name: "Namibia", alpha2: "NA", alpha3: "NAM" },
  { name: "Nauru", alpha2: "NR", alpha3: "NRU" },
  { name: "Nepal", alpha2: "NP", alpha3: "NPL" },
  { name: "Netherlands", alpha2: "NL", alpha3: "NLD" },
  { name: "New Zealand", alpha2: "NZ", alpha3: "NZL" },
  { name: "Nicaragua", alpha2: "NI", alpha3: "NIC" },
  { name: "Niger", alpha2: "NE", alpha3: "NER" },
  { name: "Nigeria", alpha2: "NG", alpha3: "NGA" },
  { name: "North Macedonia", alpha2: "MK", alpha3: "MKD" },
  { name: "Norway", alpha2: "NO", alpha3: "NOR" },
  { name: "Oman", alpha2: "OM", alpha3: "OMN" },
  { name: "Pakistan", alpha2: "PK", alpha3: "PAK" },
  { name: "Palau", alpha2: "PW", alpha3: "PLW" },
  { name: "Panama", alpha2: "PA", alpha3: "PAN" },
  { name: "Papua New Guinea", alpha2: "PG", alpha3: "PNG" },
  { name: "Paraguay", alpha2: "PY", alpha3: "PRY" },
  { name: "Peru", alpha2: "PE", alpha3: "PER" },
  { name: "Philippines", alpha2: "PH", alpha3: "PHL" },
  { name: "Poland", alpha2: "PL", alpha3: "POL" },
  { name: "Portugal", alpha2: "PT", alpha3: "PRT" },
  { name: "Qatar", alpha2: "QA", alpha3: "QAT" },
  { name: "Romania", alpha2: "RO", alpha3: "ROU" },
  { name: "Russia", alpha2: "RU", alpha3: "RUS" },
  { name: "Rwanda", alpha2: "RW", alpha3: "RWA" },
  { name: "Saint Kitts and Nevis", alpha2: "KN", alpha3: "KNA" },
  { name: "Saint Lucia", alpha2: "LC", alpha3: "LCA" },
  { name: "Saint Vincent and the Grenadines", alpha2: "VC", alpha3: "VCT" },
  { name: "Samoa", alpha2: "WS", alpha3: "WSM" },
  { name: "San Marino", alpha2: "SM", alpha3: "SMR" },
  { name: "Sao Tome and Principe", alpha2: "ST", alpha3: "STP" },
  { name: "Saudi Arabia", alpha2: "SA", alpha3: "SAU" },
  { name: "Senegal", alpha2: "SN", alpha3: "SEN" },
  { name: "Serbia", alpha2: "RS", alpha3: "SRB" },
  { name: "Seychelles", alpha2: "SC", alpha3: "SYC" },
  { name: "Sierra Leone", alpha2: "SL", alpha3: "SLE" },
  { name: "Singapore", alpha2: "SG", alpha3: "SGP" },
  { name: "Slovakia", alpha2: "SK", alpha3: "SVK" },
  { name: "Slovenia", alpha2: "SI", alpha3: "SVN" },
  { name: "Solomon Islands", alpha2: "SB", alpha3: "SLB" },
  { name: "Somalia", alpha2: "SO", alpha3: "SOM" },
  { name: "South Africa", alpha2: "ZA", alpha3: "ZAF" },
  { name: "South Sudan", alpha2: "SS", alpha3: "SSD" },
  { name: "South Korea", alpha2: "KR", alpha3: "KOR" },
  { name: "Spain", alpha2: "ES", alpha3: "ESP" },
  { name: "Sri Lanka", alpha2: "LK", alpha3: "LKA" },
  { name: "Sudan", alpha2: "SD", alpha3: "SDN" },
  { name: "Suriname", alpha2: "SR", alpha3: "SUR" },
  { name: "Sweden", alpha2: "SE", alpha3: "SWE" },
  { name: "Switzerland", alpha2: "CH", alpha3: "CHE" },
  { name: "Syria", alpha2: "SY", alpha3: "SYR" },
  { name: "Taiwan", alpha2: "TW", alpha3: "TWN" },
  { name: "Tajikistan", alpha2: "TJ", alpha3: "TJK" },
  { name: "Tanzania", alpha2: "TZ", alpha3: "TZA" },
  { name: "Thailand", alpha2: "TH", alpha3: "THA" },
  { name: "Timor-Leste", alpha2: "TL", alpha3: "TLS" },
  { name: "Togo", alpha2: "TG", alpha3: "TGO" },
  { name: "Tonga", alpha2: "TO", alpha3: "TON" },
  { name: "Trinidad and Tobago", alpha2: "TT", alpha3: "TTO" },
  { name: "Tunisia", alpha2: "TN", alpha3: "TUN" },
  { name: "Turkey", alpha2: "TR", alpha3: "TUR" },
  { name: "Turkmenistan", alpha2: "TM", alpha3: "TKM" },
  { name: "Tuvalu", alpha2: "TV", alpha3: "TUV" },
  { name: "Uganda", alpha2: "UG", alpha3: "UGA" },
  { name: "Ukraine", alpha2: "UA", alpha3: "UKR" },
  { name: "United Arab Emirates", alpha2: "AE", alpha3: "ARE" },
  { name: "United Kingdom", alpha2: "GB", alpha3: "GBR" },
  { name: "United States", alpha2: "US", alpha3: "USA" },
  { name: "Uruguay", alpha2: "UY", alpha3: "URY" },
  { name: "Uzbekistan", alpha2: "UZ", alpha3: "UZB" },
  { name: "Vanuatu", alpha2: "VU", alpha3: "VUT" },
  { name: "Vatican City", alpha2: "VA", alpha3: "VAT" },
  { name: "Venezuela", alpha2: "VE", alpha3: "VEN" },
  { name: "Vietnam", alpha2: "VN", alpha3: "VNM" },
  { name: "Yemen", alpha2: "YE", alpha3: "YEM" },
  { name: "Zambia", alpha2: "ZM", alpha3: "ZMB" },
  { name: "Zimbabwe", alpha2: "ZW", alpha3: "ZWE" },
];

// Function to get full country name by ISO code
const getCountryName = (code: any) => {
  const country = countries.find(
    (c) => c.alpha2 === code || c.alpha3 === code || c.name === code,
  );

  return country ? country.name : code;
};

/**
 * Converts Map data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} mapData - the map data
 * @return {Object} - the option object for rendering the map chart
 */
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

export const convertMapsData = (panelSchema: any, mapData: any) => {
  //if no name and value than return it
  if (
    !panelSchema.queries[0]?.fields?.name ||
    !panelSchema.queries[0]?.fields?.value_for_maps ||
    !mapData
  ) {
    return { options: null };
  }

  const options: any = {};

  options.tooltip = {
    trigger: "item",
    showDelay: 0,
    transitionDuration: 0.2,
    backgroundColor: "rgba(255,255,255,0.8)",
    formatter: function (params: any) {
      let formattedValue = params.value;
      if (formattedValue === "-" || isNaN(formattedValue)) {
        formattedValue = "-";
      } else if (getUnitValue && formatUnitValue) {
        formattedValue = formatUnitValue(
          getUnitValue(
            formattedValue,
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          ),
        );
      }

      return `${params.name}: ${formattedValue}`;
    },
  };

  options.visualMap = {
    left: "right",
    inRange: {
      color: [
        "#313695",
        "#4575b4",
        "#74add1",
        "#abd9e9",
        "#e0f3f8",
        "#ffffbf",
        "#fee090",
        "#fdae61",
        "#f46d43",
        "#d73027",
        "#a50026",
      ],
    },
    text: ["High", "Low"],
    calculable: true,
  };

  options.toolbox = {
    show: true,
    left: "left",
    top: "top",
  };
  options.xAxis = [];
  options.yAxis = [];
  options.series = panelSchema.queries.map((query: any, index: any) => {
    return {
      type: "map",
      map: "world",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: mapData[index]?.map((item: any) => {
        const countryName = getCountryName(item[query.fields.name.alias]); // Map to full country name
        const value = item[query.fields.value_for_maps.alias];

        if (query.customQuery) {
          // For custom queries
          return { name: countryName, value };
        } else {
          // For auto queries
          return { name: countryName, value };
        }
      }),
      symbolSize: function (val: any) {
        return val[2];
      },
      itemStyle: {
        color: "#b02a02",
      },
      encode: {
        value: 2,
      },
    };
  });
  if (!options.series.map((item: any) => item.data).every(Array.isArray)) {
    return;
  }

  const seriesData = options.series.flatMap((series: any) => series.data);

  if (seriesData.length > 0) {
    const minValue = Math.min(...seriesData.map((item: any) => item.value));
    const maxValue = Math.max(...seriesData.map((item: any) => item.value));

    options.visualMap.min = minValue;
    options.visualMap.max = maxValue;
  } else {
    options.visualMap = [];
    options.series = [];
  }

  return { options };
};
